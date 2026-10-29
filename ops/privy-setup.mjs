#!/usr/bin/env node
// Creates GrokGrid's Privy agent signer (a 1-of-1 key quorum holding the public half of the
// authorization key) and the Solana policy that limits what that signer may sign.
// Prints only public IDs, the policy fingerprint and a summary. Never prints a secret.
//   node ops/privy-setup.mjs --dry-build   build the policy offline, no secrets, no network
//   node ops/privy-setup.mjs               create (or reuse) the signer and create the policy
import { createRequire } from 'node:module';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { privyPolicyFingerprint } from '../api/_privy-readiness.ts';

const require = createRequire(import.meta.url);
const RUNTIME = process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime');
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
// The approved global per-trade cap. Agents with a lower maxSol are capped lower by the runner.
const MAX_TRADE_LAMPORTS = process.env.GROKGRID_MAX_TRADE_LAMPORTS || '50000000';

/** An IDL trimmed to the named instructions, keeping each one whole plus every type it uses. */
export function trimIdl(idl, names) {
  const instructions = idl.instructions.filter(i => names.includes(i.name));
  if (instructions.length !== names.length) throw Error('IDL is missing an instruction');
  const used = new Set(), walk = t => { if (!t || typeof t !== 'object') return; if (t.defined) used.add(t.defined.name ?? t.defined); Object.values(t).forEach(walk); };
  instructions.forEach(i => i.args.forEach(a => walk(a.type)));
  let grew = true;
  while (grew) { grew = false; for (const t of idl.types || []) if (used.has(t.name)) { const before = used.size; walk(t.type); if (used.size > before) grew = true; } }
  return { address: idl.address, metadata: idl.metadata, instructions, types: (idl.types || []).filter(t => used.has(t.name)) };
}

const program = id => ({ field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: id });
const arg = (idl, field, operator, value) => ({ field_source: 'solana_instruction_data', idl, field, operator, value });

/** Default deny. Each rule names its program; IDL limits sit in the same rule as the program check. */
export function buildRules(maxTrade = MAX_TRADE_LAMPORTS) {
  const pump = trimIdl(require('@pump-fun/pump-sdk').pumpIdl, ['buy', 'sell']);
  const amm = trimIdl(require('@pump-fun/pump-swap-sdk').pumpAmmJson, ['sell']);
  const rule = (name, conditions) => ({ name, method: 'signTransaction', action: 'ALLOW', conditions });
  return [
    rule('compute budget', [program(COMPUTE_BUDGET)]),
    rule('create token accounts', [program(ATA)]),
    rule('pump.fun curve buy, capped', [program(PUMP), arg(pump, 'buy.args.max_sol_cost', 'lte', maxTrade)]),
    rule('pump.fun curve sell', [program(PUMP), arg(pump, 'sell.args.min_sol_output', 'gte', '1')]),
    rule('PumpSwap sell', [program(AMM), arg(amm, 'sell.args.min_quote_amount_out', 'gte', '1')]),
    // Deliberately absent: System Program transfers, SyncNative and CloseAccount. Their recipient
    // can't be pinned to the agent's own accounts here, so a stolen key could drain through them.
  ];
}

export const summary = maxTrade => `GrokGrid agent signer may only sign: pump.fun curve buys up to ${Number(maxTrade) / 1e9} SOL per instruction, curve and PumpSwap sells, compute budget, token-account creation. No SOL transfers, WSOL close, message signing or key export.`;

function secretFile(name) {
  const path = join(RUNTIME, name);
  if (!existsSync(path)) throw Error(`${name} missing: save it first with the one-liner`);
  if ((statSync(path).mode & 0o077) !== 0) throw Error(`${name} must be mode 0600`);
  return readFileSync(path, 'utf8').trim();
}

/** The authorization key's public half (base64 DER SPKI); the private key stays in memory only. */
export function authorizationPublicKey(raw) {
  const der = Buffer.from(raw.replace(/^wallet-auth:/, '').replace(/-----[^-]+-----|\s+/g, ''), 'base64');
  return createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).toString('base64');
}

async function main() {
  const rules = buildRules();
  const bytes = Buffer.byteLength(JSON.stringify(rules));
  if (bytes > 128 * 1024) throw Error('policy IDLs exceed 128 KB');
  if (process.argv.includes('--dry-build')) {
    console.log(JSON.stringify({ rules: rules.map(r => r.name), policyBytes: bytes, summary: summary(MAX_TRADE_LAMPORTS) }, null, 2));
    return;
  }
  const { PrivyClient } = await import('@privy-io/node');
  const server = JSON.parse(secretFile('privy-server.json'));
  const client = new PrivyClient({ appId: server.appId, appSecret: server.appSecret });
  const publicKey = authorizationPublicKey(secretFile('privy-authorization.key'));
  const stateFile = join(RUNTIME, 'privy-setup.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  if (!state.signerId) {
    const quorum = await client.keyQuorums().create({ public_keys: [publicKey], authorization_threshold: 1, display_name: 'grokgrid-agent-signer' });
    state.signerId = quorum.id;
  }
  // The signer quorum owns the policy, so the app secret alone cannot loosen it.
  const policy = await client.policies().create({ version: '1.0', name: 'grokgrid-agent-trading', chain_type: 'solana', owner_id: state.signerId, rules });
  const sha = privyPolicyFingerprint({ id: policy.id, version: policy.version, chainType: policy.chain_type, ownerId: policy.owner_id, rules: policy.rules });
  Object.assign(state, { appId: server.appId, policyId: policy.id, policySha256: sha, policySummary: summary(MAX_TRADE_LAMPORTS), createdAt: new Date().toISOString() });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({
    PRIVY_APP_ID: server.appId, PRIVY_AGENT_SIGNER_ID: state.signerId, PRIVY_AGENT_POLICY_ID: policy.id,
    PRIVY_AGENT_POLICY_SHA256: sha, PRIVY_AGENT_POLICY_SUMMARY: state.policySummary, PRIVY_AGENT_SIGNER_PUBLIC_KEY: publicKey,
    VITE_PRIVY_APP_ID: server.appId, VITE_PRIVY_AGENT_SIGNER_ID: state.signerId, VITE_PRIVY_AGENT_POLICY_ID: policy.id,
    secretsToSetYourself: ['PRIVY_APP_SECRET'], // the authorization key stays on this Mac only; the site never signs
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`privy setup failed: ${String(e?.message || e).slice(0, 200)}`); process.exit(1); });
