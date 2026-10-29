#!/usr/bin/env node
// Routes creator fees for $GRID and every bot coin: sends pump.fun's permissionless
// sweep + distribute instructions from the house wallet so each coin's fee-sharing config pays
// its shareholders. Off unless fee-distributor-config.json says enabled; while off it only
// reports what it would distribute. The house pays the network fee and nothing else
// (checked by simulation before signing). launchd runs it every 10 minutes.
//   node scripts/fee-distributor.mjs [--once]
//   node scripts/fee-distributor.mjs --probe <mint>   build and simulate one coin; never signs
import { createRequire } from 'node:module';
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { connect, loadSigner, signedSignature } from './pump-chain.mjs';
import { action } from './runtime-ingest.mjs';
import { DEFAULT_DISTRIBUTOR, validateDistributorConfig, coinsToDistribute, distributeGate, checkInstructions, houseCostOk } from './fee-distributor-core.mjs';

const require = createRequire(import.meta.url);
const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const ORIGIN = 'https://grokgrid-alpha.vercel.app';
const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(root, name), 'utf8')); } catch { return fallback; } };
const save = async (name, value) => { const tmp = join(root, `.${name}.tmp`); await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, join(root, name)); };
const exists = p => access(p).then(() => true, () => false);
const args = process.argv.slice(2), probe = args.includes('--probe') ? args[args.indexOf('--probe') + 1] : null;

async function tick() {
  const now = Date.now();
  const cfg = validateDistributorConfig({ ...DEFAULT_DISTRIBUTOR, ...(await read('fee-distributor-config.json', {})) });
  const trading = await read('trading-config.json', null), obs = await read('observer-config.json', null), buyback = await read('buyback-config.json', {});
  if (!trading?.wallet || !obs?.rpcUrl) throw Error('runtime config missing');
  const conn = connect(obs.rpcUrl), online = new OnlinePumpSdk(conn), house = new PublicKey(trading.wallet);
  let registry = [];
  try { registry = (await (await fetch(`${ORIGIN}/api/agents`, { redirect: 'error', signal: AbortSignal.timeout(10000) })).json()).agents || []; } catch {}
  const state = await read('fee-distributor-state.json', { version: 1, mints: {} });
  // Mark sends that finalized, so trade sizing counts only fees that really reached a wallet.
  for (const e of (state.history || []).filter(e => e.confirmed === undefined && now - e.at < 3600_000)) {
    try { const { value: [st] } = await conn.getSignatureStatuses([e.signature], { searchTransactionHistory: true });
      if (st?.confirmationStatus === 'finalized') e.confirmed = st.err === null; } catch {}
  }
  const stopped = trading.stopFile ? await exists(trading.stopFile) : false;
  const live = !probe && cfg.enabled && !stopped && trading.keypairFile;
  const signer = live ? await loadSigner(trading.keypairFile, trading.wallet) : null;
  const results = [];
  for (const mint of probe ? [probe] : coinsToDistribute(buyback.officialMint, registry)) {
    let fee = null;
    try { fee = await online.getMinimumDistributableFee(new PublicKey(mint), house); } catch {}
    const info = fee ? { distributableFees: fee.distributableFees.toString(), minimumRequired: fee.minimumRequired.toString(), canDistribute: fee.canDistribute } : null;
    let result = distributeGate(cfg, state, mint, info, now);
    if (result === 'ok') {
      try {
        const { instructions } = await online.buildDistributeCreatorFeesInstructions(new PublicKey(mint), { payer: house });
        result = checkInstructions(instructions);
        if (result === 'ok') {
          const latest = await conn.getLatestBlockhash('finalized');
          const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), ...instructions];
          const tx = new VersionedTransaction(new TransactionMessage({ payerKey: house, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message());
          const pre = await conn.getBalance(house, 'confirmed');
          const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false, accounts: { encoding: 'base64', addresses: [house.toBase58()] } });
          const post = sim.value.accounts?.[0]?.lamports;
          if (sim.value.err) result = 'simulation-failed';
          else if (!houseCostOk(pre, post, cfg)) result = 'house-cost-too-high';
          else if (!signer) result = 'dry-run-would-distribute';
          else {
            tx.sign([signer]);
            const signature = signedSignature(tx);
            state.mints[mint] = { at: now, signature, lamports: info.distributableFees };
            state.history = [...(state.history || []), { mint, at: now, signature, lamports: info.distributableFees }].slice(-500);
            await save('fee-distributor-state.json', state); // recorded before broadcast; a resend waits retryMinutes
            await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
            result = 'sent';
            const sym = registry.find(a => a.coin?.mint === mint)?.coin?.symbol || (mint === buyback.officialMint ? 'GRID' : 'a coin');
            await action(root, `routed ${(Number(info.distributableFees) / 1e9).toFixed(3)} SOL of $${sym} creator fees`).catch(() => {});
          }
        }
      } catch (e) { result = `error:${String(e?.message || e).slice(0, 60)}`; }
    }
    results.push({ mint, fee: info, result });
  }
  if (probe) { console.log(JSON.stringify(results)); return; }
  await save('fee-distributor-status.json', { observedAt: new Date(now).toISOString(), enabled: cfg.enabled, live: !!signer, stopped, coins: results });
  console.log(JSON.stringify({ enabled: cfg.enabled, live: !!signer, coins: results.length, sent: results.filter(r => r.result === 'sent').length }));
}

if (import.meta.url === `file://${process.argv[1]}`) tick().catch(e => { console.error(`fee distributor: ${String(e?.message || e).slice(0, 120)}`); process.exit(1); });
