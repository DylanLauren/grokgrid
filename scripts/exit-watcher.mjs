#!/usr/bin/env node
// Fast exits for the house: every few seconds it prices each held coin from an on-chain sell
// quote (the SOL a sell would return right now) and runs the strategy's own exit rules
// (take-profit, stop-loss, trailing stop, max hold) through livePlan, sells only. A sell it plans
// goes into the same trading journal, and the trading worker is kicked to sign it at once, so a
// coin that dumps between the minute-long market scans is still sold near its stop.
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
import { quotePrices } from './exit-watcher-core.mjs';

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
  const c = validateStrategyConfig({ ...DEFAULT_STRATEGY, ...await json(join(root, 'strategy-config.json')), mode: 'live' });
  if (!executes(policy) || (policy.stopFile && await exists(policy.stopFile))) return { state: 'idle', reason: executes(policy) ? 'stop-file' : 'observe-only' };
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
    await savePrivate('exit-watcher-state.json', { peaks: planned.peaks, observedAt: now });
    const sell = planned.proposals.find(p => p.side === 'sell');
    if (!sell) return s;
    const { reason, ...proposal } = sell;
    try { s = planIntent(s, policy, proposal, observation, null, now, positions); sold = { mint: sell.mint, reason }; } catch (e) { sold = { mint: sell.mint, reason, refused: String(e?.message || e).slice(0, 80) }; }
    return s;
  });
  if (sold && !sold.refused) {
    // Sign now instead of waiting for the trading worker's next 30-second tick.
    await run('launchctl', ['kickstart', `gui/${process.getuid()}/fun.grokgrid.trading-observer`], { timeout: 10000 }).catch(() => {});
    await action(root, `exit ${sold.reason} planned within seconds`).catch(() => {});
  }
  return { state: 'watching', held: held.length, quoted: quotes.size, sold };
}

async function main() {
  const rootStat = await lstat(root); if (!rootStat.isDirectory() || !ownedPrivate(rootStat)) throw Error('Runtime directory must be private and owned');
  const conn = connect((await json(join(root, 'observer-config.json'))).rpcUrl);
  const once = process.argv.includes('--once');
  for (;;) {
    const status = await tick(conn).catch(e => ({ state: 'error', error: String(e?.message || e).slice(0, 120).replace(/api-key=[^&\s]+/gi, '') }));
    await savePrivate('exit-watcher-status.json', { observedAt: new Date().toISOString(), ...status }).catch(() => {});
    if (once) { console.log(JSON.stringify(status)); return; }
    await new Promise(r => setTimeout(r, EVERY_MS));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`exit watcher: ${String(e?.message || e).slice(0, 120)}`); process.exit(1); });
