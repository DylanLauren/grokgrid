#!/usr/bin/env node
// Fast exits for the house: every few seconds it prices each held coin from an on-chain sell
// quote (the SOL a sell would return right now) and runs the strategy's own exit rules
// (take-profit, stop-loss, trailing stop, max hold) through livePlan, sells only. A sell it plans
// goes into the same trading journal, and the trading worker is kicked to sign it at once, so a
// coin that dumps between the minute-long market scans is still sold near its stop.
// User bots get the same: each one holding a coin has its wallet read and its exits checked on
// the same few-second loop, with its own rules and limits, and a planned sell kicks the agent
// runner, which signs through that bot's own Privy permission.
// It never buys, signs or changes limits. launchd keeps it running; a STOP file pauses it.
//   node scripts/exit-watcher.mjs [--once]
import { open, rename, unlink, access, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { validateStrategyConfig, DEFAULT_STRATEGY } from './strategy-policy.mjs';
import { livePlan } from './strategy-engine.mjs';
import { connect, quoteSell } from './pump-chain.mjs';
import { validateTradingPolicy, planIntent, executes } from './trading-policy.mjs';
import { withTradingStore } from './trading-store.mjs';
import { action } from './runtime-ingest.mjs';
import { quotePrices, confirmExit, sellJustExpired, heldFromJournal } from './exit-watcher-core.mjs';
import { validateRunnerConfig, agentTradingPolicy, agentStrategy } from './agent-runner-core.mjs';
import { collectFinalizedPositions } from './trading-positions.mjs';
import { PublicKey } from '@solana/web3.js';
import { safeError } from './log-safe.mjs';
import { recordWhys } from './trade-why.mjs';

const run = promisify(execFile);
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const EVERY_MS = 5000;
const ownedPrivate = s => (!process.getuid || s.uid === process.getuid()) && (s.mode & 0o077) === 0;
async function json(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await handle.stat(); if (!s.isFile() || !ownedPrivate(s) || s.size > 4 * 1024 * 1024) throw Error('Runtime input must be private and owned'); return JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
}
async function savePrivate(name, value) {
  const tmp = join(root, `.${name}.${randomUUID()}.tmp`); let handle;
  try { handle = await open(tmp, 'wx', 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.close(); handle = null; await rename(tmp, join(root, name)); }
  finally { if (handle) await handle.close(); await unlink(tmp).catch(() => {}); }
}
const exists = p => access(p).then(() => true, () => false);

async function tick(conn) {
  const now = Date.now();
  const policy = validateTradingPolicy(await json(join(root, 'trading-config.json')));
  const c = validateStrategyConfig({ ...DEFAULT_STRATEGY, ...await json(join(root, 'strategy-config.json')) });
  // Same gates as the live strategy: live mode, execute mode, a dynamic allowlist, no STOP file.
  if (c.mode !== 'live') return { state: 'idle', reason: 'strategy-paper' };
  if (!executes(policy) || policy.allowedMints !== 'dynamic' || (policy.stopFile && await exists(policy.stopFile))) return { state: 'idle', reason: executes(policy) ? 'stop-file-or-static-allowlist' : 'observe-only' };
  const positions = await json(join(root, 'trading-positions.json'));
  if (!positions?.complete || positions.wallet !== policy.wallet) return { state: 'idle', reason: 'positions-unavailable' };
  const held = positions.positions.filter(p => BigInt(p.spendableTokenUnits) > 0n);
  if (!held.length) return { state: 'idle', reason: 'nothing-held' };
  const quotes = new Map();
  for (const p of held) { try { const q = await quoteSell(conn, { mint: p.mint, tokenUnits: p.spendableTokenUnits, tokenProgram: p.tokenProgram }); if (q) quotes.set(p.mint, q); } catch {} }
  // Prices from the quotes themselves; livePlan's 15% cross-check then compares like with like.
  const market = { metrics: new Map(), facts: new Map(), prices: quotePrices(held, quotes), sellQuotes: quotes };
  let live = {}; try { live = await json(join(root, 'strategy-live.json')); } catch {}
  let mine = {}; try { mine = await json(join(root, 'exit-watcher-state.json')); } catch {}
  const peaks = { ...live.peaks };
  for (const [m, v] of Object.entries(mine.peaks || {})) peaks[m] = Math.max(peaks[m] || 0, v);
  const observation = await json(join(root, 'observer-status.json'));
  let sold = null;
  await withTradingStore(join(root, 'trading'), policy, async s => {
    const planned = livePlan({ tradingState: s, policy, c, peaks, entries: live.entries || {}, positions, market, now, liquidating: false });
    const sell = planned.proposals.find(p => p.side === 'sell');
    // Two consecutive checks must agree before a quote-triggered sell is planned.
    const pending = {};
    let confirmed = false;
    if (sell) {
      // A sell that was already confirmed but expired unsent is re-planned without waiting again.
      const r = confirmExit(mine.pending, sell.mint, sell.reason, now); confirmed = r.fire || sellJustExpired(s.intents, sell.mint, now);
      if (!confirmed && r.pending) pending[sell.mint] = r.pending;
    }
    await savePrivate('exit-watcher-state.json', { peaks: planned.peaks, pending, observedAt: now });
    if (!sell || !confirmed) return s;
    const { reason, why, ...proposal } = sell;
    try { s = planIntent(s, policy, proposal, observation, null, now, positions); sold = { mint: sell.mint, reason, id: sell.id, why }; } catch (e) { sold = { mint: sell.mint, reason, refused: String(e?.message || e).slice(0, 80) }; }
    return s;
  });
  if (sold && !sold.refused) {
    await recordWhys(join(root, 'trade-why-exit.json'), { [sold.id]: sold.why }, now).catch(() => {});
    // Sign now instead of waiting for the trading worker's next 30-second tick.
    await run('launchctl', ['kickstart', `gui/${process.getuid()}/fun.grokgrid.trading-observer`], { timeout: 10000 }).catch(() => {});
    await action(root, `exit ${sold.reason} planned within seconds`).catch(() => {});
  }
  return { state: 'watching', held: held.length, quoted: quotes.size, sold };
}

/** One fast-exit pass over every user bot that holds a coin. Sells only, through each bot's own journal. */
async function agentTick(conn, rpcUrl) {
  const now = Date.now();
  let runner; try { runner = validateRunnerConfig(await json(join(root, 'agent-runner-config.json'))); } catch { return { state: 'idle', reason: 'runner-config' }; }
  if (runner.mode !== 'execute' || await exists(runner.stopFile)) return { state: 'idle', reason: runner.mode !== 'execute' ? 'runner-paper' : 'stop-file' };
  let registry; try { registry = await json(join(root, 'agent-runner-state.json')); } catch { return { state: 'idle', reason: 'no-agents' }; }
  let global = { ...DEFAULT_STRATEGY }; try { global = await json(join(root, 'strategy-config.json')); } catch {}
  global = validateStrategyConfig({ ...DEFAULT_STRATEGY, ...global, mode: 'live' });
  let mine = {}; try { mine = await json(join(root, 'exit-watcher-agents.json')); } catch {}
  const next = {}, sold = [];
  let watched = 0;
  for (const a of Object.values(registry.agents || {}).filter(a => a.status === 'ready' && a.rules && a.privyWalletId)) {
    const dir = join(root, 'agents', a.id);
    let journal; try { journal = await json(join(dir, 'trading', 'trading-journal.json')); } catch { continue; }
    if (!heldFromJournal(journal.state?.intents).size) continue;
    try {
      const policy = agentTradingPolicy(runner, { ...a, maxTradeLamports: a.rules.maxTradeLamports });
      if (!executes(policy)) continue;
      const c = agentStrategy(global, a.rules);
      const positions = await collectFinalizedPositions(rpcUrl, a.wallet);
      if (!positions?.complete) continue;
      const held = positions.positions.filter(p => BigInt(p.spendableTokenUnits) > 0n);
      if (!held.length) continue;
      watched++;
      const quotes = new Map();
      for (const p of held) { try { const q = await quoteSell(conn, { mint: p.mint, tokenUnits: p.spendableTokenUnits, tokenProgram: p.tokenProgram }); if (q) quotes.set(p.mint, q); } catch {} }
      const market = { metrics: new Map(), facts: new Map(), prices: quotePrices(held, quotes), sellQuotes: quotes };
      let live = {}; try { live = await json(join(dir, 'strategy-live.json')); } catch {}
      const prev = mine[a.id] || {}, peaks = { ...live.peaks };
      for (const [m, v] of Object.entries(prev.peaks || {})) peaks[m] = Math.max(peaks[m] || 0, v);
      const balance = String(await conn.getBalance(new PublicKey(a.wallet), 'finalized'));
      const observation = { observedAt: new Date(now).toISOString(), status: 'observing', mode: 'observe-only', executionEnabled: false, signingEnabled: false, house: { wallet: a.wallet, balanceLamports: balance } };
      let planned = null;
      await withTradingStore(join(dir, 'trading'), policy, async s => {
        const plan = livePlan({ tradingState: s, policy, c, peaks, entries: live.entries || {}, positions, market, now, liquidating: false });
        const sell = plan.proposals.find(p => p.side === 'sell');
        const pending = {};
        let confirmed = false;
        if (sell) { const r = confirmExit(prev.pending, sell.mint, sell.reason, now); confirmed = r.fire || sellJustExpired(s.intents, sell.mint, now); if (!confirmed && r.pending) pending[sell.mint] = r.pending; }
        next[a.id] = { peaks: plan.peaks, pending };
        if (!sell || !confirmed) return s;
        const { reason, why, ...proposal } = sell;
        try { s = planIntent(s, policy, proposal, observation, null, now, positions); planned = { id: sell.id, mint: sell.mint, reason, why }; } catch {}
        return s;
      });
      if (planned) { sold.push({ agent: a.id, mint: planned.mint, reason: planned.reason }); await recordWhys(join(dir, 'trade-why-exit.json'), { [planned.id]: planned.why }, now).catch(() => {}); }
    } catch (e) { next[a.id] = { ...(mine[a.id] || {}), error: e?.code === 'TRADING_LOCKED' ? 'journal-busy' : safeError(e, 60) }; }
  }
  await savePrivate('exit-watcher-agents.json', next);
  // Signing happens in the agent runner, with each bot's Privy permission: start its next pass now.
  if (sold.length) await run('launchctl', ['kickstart', `gui/${process.getuid()}/fun.grokgrid.agent-runner`], { timeout: 10000 }).catch(() => {});
  return { state: 'watching', bots: watched, sold };
}

async function main() {
  const rootStat = await lstat(root); if (!rootStat.isDirectory() || !ownedPrivate(rootStat)) throw Error('Runtime directory must be private and owned');
  const rpcUrl = (await json(join(root, 'observer-config.json'))).rpcUrl, conn = connect(rpcUrl);
  const once = process.argv.includes('--once');
  for (;;) {
    const status = await tick(conn).catch(e => ({ state: 'error', error: safeError(e).replace(/api-key=[^&\s]+/gi, '') }));
    const bots = await agentTick(conn, rpcUrl).catch(e => ({ state: 'error', error: safeError(e).replace(/api-key=[^&\s]+/gi, '') }));
    await savePrivate('exit-watcher-status.json', { observedAt: new Date().toISOString(), ...status, bots }).catch(() => {});
    if (once) { console.log(JSON.stringify({ ...status, bots })); return; }
    await new Promise(r => setTimeout(r, EVERY_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`exit watcher: ${safeError(e)}`); process.exit(1); });
