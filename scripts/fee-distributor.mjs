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
import { action, postFees } from './runtime-ingest.mjs';
import { DEFAULT_DISTRIBUTOR, validateDistributorConfig, coinsToDistribute, distributeGate, checkInstructions, houseCostOk, payoutsIn, lifetimeFeesSol, nextBatch } from './fee-distributor-core.mjs';
import { safeError } from './log-safe.mjs';

const require = createRequire(import.meta.url);
const { OnlinePumpSdk, feeSharingConfigPda } = require('@pump-fun/pump-sdk');
const bs58 = require('bs58');
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const ORIGIN = 'https://grokgrid-alpha.vercel.app';
const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(root, name), 'utf8')); } catch { return fallback; } };
const save = async (name, value) => { const tmp = join(root, `.${name}.tmp`); await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, join(root, name)); };
const exists = p => access(p).then(() => true, () => false);
/**
 * Lamports each coin has paid out so far, as running totals. Every GrokGrid coin pays 20% of each
 * payout to the burn wallet, so every payout transaction touches it; reading the burn wallet's
 * history (not each coin's, which every trade on the coin also touches) finds them all, whoever
 * sent them. At most FEE_READS_PER_RUN transactions per run, oldest first, and the cursor only
 * moves past what was read.
 */
const FEE_READS_PER_RUN = 200;
async function tallyPayouts(conn, burn, prev = {}) {
  const totals = { ...(prev.totals || {}) };
  let until = prev.until ?? null, before = prev.before ?? null;
  // Newest come first, so a backlog is walked downward across runs (`before`) until it meets
  // the last signature read (`until`); only then is the oldest unread part known and read.
  const fresh = [];
  let reached = false;
  for (let page = 0; page < 5; page++) {
    const sigs = await conn.getSignaturesForAddress(new PublicKey(burn), { limit: 1000, ...(before ? { before } : {}), ...(until ? { until } : {}) }, 'finalized');
    fresh.push(...sigs);
    if (sigs.length < 1000) { reached = true; break; }
    before = sigs.at(-1).signature;
  }
  if (!reached) return { totals, until, before, complete: false }; // keep walking down next run
  const window = prev.before ?? null; // set: signatures newer than this are still unread
  for (const s of nextBatch(fresh, FEE_READS_PER_RUN)) {
    // Raw RPC: only inner instructions are needed, and web3.js can't decode newer tx versions.
    const res = await conn._rpcRequest('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);
    const tx = res?.result;
    if (res?.error || !tx) break; // not readable yet: keep what was read, retry the rest next run
    for (const [mint, lamports] of payoutsIn(tx, burn, d => bs58.decode(d))) totals[mint] = (BigInt(totals[mint] ?? '0') + lamports).toString();
    until = s.signature;
  }
  const doneHere = until === (fresh.find(x => !x.err)?.signature ?? until);
  // Each run reads the oldest 200 unread, so the tally always moves forward, however busy
  // the burn wallet is. Totals are posted only when nothing is left unread.
  return { totals, until, before: doneHere ? null : window, complete: doneHere && !window };
}

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
  // The burn wallet is the 20% shareholder of every GrokGrid coin (buyback-config.json).
  if (!probe && typeof buyback.burnWallet === 'string') await reportFees(conn, online, house, registry, buyback.officialMint, buyback.burnWallet, state, results);
  if (probe) { console.log(JSON.stringify(results)); return; }
  await save('fee-distributor-status.json', { observedAt: new Date(now).toISOString(), enabled: cfg.enabled, live: !!signer, stopped, coins: results });
  console.log(JSON.stringify({ enabled: cfg.enabled, live: !!signer, coins: results.length, sent: results.filter(r => r.result === 'sent').length }));
}

/** Lifetime creator fees per coin, posted to the matrix when they change. Never blocks routing. */
async function reportFees(conn, online, house, registry, officialMint, burn, state, results) {
  const owners = new Map(registry.filter(a => !a.house && a.coin?.mint).map(a => [a.coin.mint, a.id]));
  if (officialMint) owners.set(officialMint, 'house');
  state.fees ??= {};
  let tally;
  try { tally = await tallyPayouts(conn, burn, state.feeTally); state.feeTally = { totals: tally.totals, until: tally.until, before: tally.before }; }
  catch (e) { results.push({ feesError: String(e?.message || e).slice(0, 60) }); }
  // While payouts are still unread a total would be low: keep showing the last ones.
  if (tally?.complete) for (const [mint, agent] of owners) {
    try {
      // Read after the tally, so a payout landing in between counts as paid, never twice.
      const waiting = (await online.getMinimumDistributableFee(new PublicKey(mint), house)).distributableFees.toString();
      const feesSol = lifetimeFeesSol(tally.totals[mint] ?? '0', waiting);
      const prev = state.fees[mint] || {};
      state.fees[mint] = { feesSol, posted: prev.posted ?? null };
      if (feesSol !== null && feesSol !== prev.posted && (await postFees(root, { agent, feesSol })) === true) state.fees[mint].posted = feesSol;
    } catch {}
  } else if (tally) results.push({ feesError: 'payout history still being read; totals held' });
  await save('fee-distributor-state.json', state);
}

if (import.meta.url === `file://${process.argv[1]}`) tick().catch(e => { console.error(`fee distributor: ${safeError(e)}`); process.exit(1); });
