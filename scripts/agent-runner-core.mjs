// Agent runner rules: each launched agent trades from its own wallet, with its owner's
// rules, never looser than the global caps. Pure apart from the Privy signer.
import { createHash } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { validateTradingPolicy } from './trading-policy.mjs';
import { tighten } from './strategy-policy.mjs';

const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
const absolute = x => typeof x === 'string' && x.startsWith('/');
const min = (a, b) => (BigInt(a) < BigInt(b) ? a : b);

/** Runs fn over items with at most `limit` in flight. Results keep the input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function validateRunnerConfig(c) {
  if (!c || c.version !== 1 || !['paper', 'execute'].includes(c.mode)) throw Error('Unsupported runner config');
  if (!absolute(c.stopFile) || !absolute(c.exitFile)) throw Error('Runner needs absolute stop and exit files');
  if (c.mode === 'execute' && (!absolute(c.privyServerFile) || !absolute(c.privyAuthorizationKeyFile))) throw Error('Execute mode needs the Privy server and authorization key files');
  if (!Number.isSafeInteger(c.maxAgents) || c.maxAgents < 1 || c.maxAgents > 500) throw Error('Invalid maxAgents');
  if (c.concurrency !== undefined && (!Number.isSafeInteger(c.concurrency) || c.concurrency < 1 || c.concurrency > 16)) throw Error('Invalid concurrency');
  const k = c.caps || {};
  for (const f of ['maxTradeLamports', 'maxExposureLamports', 'maxDailyLossLamports', 'reserveLamports']) if (!integer(k[f])) throw Error(`Invalid caps.${f}`);
  if (!Number.isSafeInteger(k.maxSlippageBps) || k.maxSlippageBps < 1 || k.maxSlippageBps > 2000) throw Error('Invalid caps.maxSlippageBps');
  if (k.maxTotalLossLamports !== undefined && !integer(k.maxTotalLossLamports)) throw Error('Invalid caps.maxTotalLossLamports');
  return c;
}

/**
 * The trading policy for one agent. Its owner's maxSol can only lower the global per-trade
 * cap. It executes only in execute mode AND with a known Privy wallet id; otherwise it observes.
 */
export function agentTradingPolicy(c, agent) {
  const execute = c.mode === 'execute' && typeof agent.privyWalletId === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(agent.privyWalletId);
  const k = c.caps;
  const trade = min(agent.maxTradeLamports, k.maxTradeLamports);
  return validateTradingPolicy({
    version: 1, mode: execute ? 'execute' : 'observe-only', executionEnabled: execute, signingEnabled: execute,
    ...(execute ? { stopFile: c.stopFile, keypairFile: c.privyAuthorizationKeyFile } : {}),
    agentId: agent.id, wallet: agent.wallet, allowedMints: 'dynamic',
    maxTradeLamports: trade, maxExposureLamports: k.maxExposureLamports, maxDailyLossLamports: k.maxDailyLossLamports,
    reserveLamports: k.reserveLamports, maxSlippageBps: k.maxSlippageBps, maxPendingIntents: 1, maxIntentAgeMs: 60000,
    ...(k.maxTotalLossLamports !== undefined ? { maxTotalLossLamports: k.maxTotalLossLamports } : {}),
  });
}

/** The agent's strategy: the global one, tightened by its owner's take-profit and stop-loss. */
export function agentStrategy(global, agent) {
  return tighten(global, {
    tradeLamports: agent.maxTradeLamports,
    takeProfit: Number(agent.takeProfitBasisPoints) / 10000,
    stopLoss: Number(agent.stopLossBasisPoints) / 10000,
  });
}

/**
 * Signs through Privy's server wallet API with the policy-scoped authorization key.
 * The fee payer must be the agent's wallet and Privy must return the identical message;
 * anything else is refused. The idempotency key ties a retry to the same message.
 */
export function privySigner({ wallets, walletId, address, authorizationKey }) {
  return async tx => {
    if (!(tx instanceof VersionedTransaction) || tx.message.staticAccountKeys[0]?.toBase58() !== address) throw Error('Agent transaction must be paid by the agent wallet');
    const message = tx.message.serialize();
    const { signed_transaction: signed } = await wallets.solana().signTransaction(walletId, {
      transaction: Buffer.from(tx.serialize()).toString('base64'),
      authorization_context: { authorization_private_keys: [authorizationKey] },
      idempotency_key: createHash('sha256').update(message).digest('hex'),
    });
    const out = VersionedTransaction.deserialize(Buffer.from(signed, 'base64'));
    const back = out.message.serialize();
    if (back.length !== message.length || back.some((b, i) => b !== message[i])) throw Error('Signer changed the transaction');
    return out;
  };
}
