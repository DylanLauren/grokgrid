#!/usr/bin/env node
// Autonomous strategy, one tick per run. Paper mode (default) simulates the whole loop and
// keeps a private journal. Live mode writes proposals into the trading journal through
// planIntent; the trading worker's executor decides whether anything is ever signed.
// The strategy is UNVALIDATED and says so in its status.
import { open, rename, lstat, unlink, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { validateStrategyConfig } from './strategy-policy.mjs';
import { gatherMarket as gather } from './strategy-data.mjs';
import { paperTick, paperSummary, emptyPaper, livePlan } from './strategy-engine.mjs';
import { connect, quoteSell } from './pump-chain.mjs';
import { validateTradingPolicy, planIntent, setAllowlist, executes } from './trading-policy.mjs';
import { withTradingStore } from './trading-store.mjs';
import { journalRisk } from './trading-executor.mjs';
import { heartbeat, action } from './runtime-ingest.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
if (process.argv.slice(2).some(x => x !== '--once')) { console.error('Usage: strategy-worker.mjs [--once]'); process.exit(1); }
const ownedPrivate = s => (!process.getuid || s.uid === process.getuid()) && (s.mode & 0o077) === 0;

async function json(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await handle.stat(); if (!s.isFile() || !ownedPrivate(s) || s.size > 16 * 1024 * 1024) throw Error('Runtime input must be private and owned'); return JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
}
async function savePrivate(name, value) {
  const tmp = join(root, `.${name}.${randomUUID()}.tmp`); let handle;
  try { handle = await open(tmp, 'wx', 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null; await rename(tmp, join(root, name)); }
  finally { if (handle) await handle.close(); await unlink(tmp).catch(() => {}); }
}
const exists = p => access(p).then(() => true, () => false);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Single-writer lock around the paper journal. */
async function withPaper(c, run) {
  const lockPath = join(root, 'strategy-paper.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw Error('Paper journal locked'); });
  try {
    let s;
    try { const e = await json(join(root, 'strategy-paper.json')); if (e.sha256 !== digest(e.state)) throw Error('Paper journal checksum mismatch'); s = e.state; }
    catch (e) { if (e?.code !== 'ENOENT') throw e; s = emptyPaper(c.paperBankrollLamports || '1000000000'); }
    const next = await run(s);
    await savePrivate('strategy-paper.json', { version: 1, state: next, sha256: digest(next) });
    return next;
  } finally { await lock.close(); await unlink(lockPath); }
}

async function tick() {
  const rs = await lstat(root); if (!rs.isDirectory() || rs.isSymbolicLink() || !ownedPrivate(rs)) throw Error('Runtime directory must be private and owned');
  const c = validateStrategyConfig(await json(join(root, 'strategy-config.json')));
  const rpc = await json(join(root, 'observer-config.json'));
  const conn = connect(rpc.rpcUrl), now = Date.now();
  const liquidating = typeof c.exitFile === 'string' && c.exitFile.startsWith('/') && await exists(c.exitFile);
  const status = { observedAt: new Date(now).toISOString(), mode: c.mode, flavor: c.flavor, strategyValidated: false, liquidating };

  if (c.mode === 'paper') {
    const held = (await withPaper(c, async s => s)).positions.map(p => p.mint);
    const market = await gather(c, conn, rpc.rpcUrl, held, now);
    const s = await withPaper(c, async prev => paperTick(prev, c, market, now, liquidating));
    Object.assign(status, { scanned: market.scanned, preScreened: market.preScreened, chainChecked: market.facts.size, paper: paperSummary(s, market), recent: s.log.slice(-10) });
    // New paper fills go to the room's live feed as plainly labelled actions, never as trades.
    let since = 0; try { since = (await json(join(root, 'strategy-status.json'))).paperPostedThrough || 0; } catch {}
    for (const l of s.log.filter(l => l.at > since).slice(-3)) await action(root, `paper: ${l.line}`);
    status.paperPostedThrough = s.log.length ? s.log[s.log.length - 1].at : since;
  } else {
    const policy = validateTradingPolicy(await json(join(root, 'trading-config.json')));
    if (policy.allowedMints !== 'dynamic') throw Error('Live strategy needs allowedMints: "dynamic"');
    const observation = await json(join(root, 'observer-status.json'));
    let positions; try { positions = await json(join(root, 'trading-positions.json')); } catch { positions = null; }
    if (!positions?.complete || positions.wallet !== policy.wallet) throw Error('Finalized positions unavailable');
    let peaks = {}; try { peaks = (await json(join(root, 'strategy-live.json'))).peaks || {}; } catch {}
    const market = await gather(c, conn, rpc.rpcUrl, positions.positions.map(p => p.mint), now);
    market.sellQuotes = new Map();
    for (const p of positions.positions) if (BigInt(p.spendableTokenUnits) > 0n) {
      try { const q = await quoteSell(conn, { mint: p.mint, tokenUnits: p.spendableTokenUnits, tokenProgram: p.tokenProgram }); if (q) market.sellQuotes.set(p.mint, q); } catch {}
    }
    const outcomes = [];
    let planned;
    await withTradingStore(join(root, 'trading'), policy, async s => {
      planned = livePlan({ tradingState: s, policy, c, peaks, positions, market, now, liquidating });
      s = setAllowlist(s, policy, planned.allowlist, now);
      for (const p of planned.proposals) {
        const { reason, ...proposal } = p;
        try {
          const risk = proposal.side === 'buy' ? (executes(policy) ? journalRisk(s, policy.wallet, now) : await json(join(root, 'trading-risk.json'))) : null;
          s = planIntent(s, policy, proposal, observation, risk, now, positions); outcomes.push({ id: p.id, side: p.side, mint: p.mint, reason, planned: true });
        } catch (e) { outcomes.push({ id: p.id, side: p.side, mint: p.mint, reason, planned: false, refused: String(e?.message || e).slice(0, 120) }); }
      }
      return s;
    });
    await savePrivate('strategy-live.json', { peaks: planned.peaks, observedAt: now });
    Object.assign(status, { scanned: market.scanned, preScreened: market.preScreened, chainChecked: market.facts.size, allowlisted: planned.allowlist.length, proposals: outcomes });
  }
  await savePrivate('strategy-status.json', status);
  await heartbeat(root, 'strategy', { mode: c.mode === 'paper' ? 'paper' : 'execute', healthy: true, note: c.mode === 'paper' ? `paper equity ${status.paper.equitySol.toFixed(3)} SOL, unvalidated` : `${status.proposals.length} proposals, unvalidated` });
  console.log(JSON.stringify({ mode: status.mode, scanned: status.scanned, chainChecked: status.chainChecked, paper: status.paper ?? null, proposals: status.proposals?.length ?? 0 }));
}

tick().catch(async e => {
  const message = String(e?.message || e).slice(0, 200).replace(/api-key=[^&\s]+/gi, 'api-key=[redacted]');
  await savePrivate('strategy-status.json', { observedAt: new Date().toISOString(), strategyValidated: false, error: message }).catch(() => {});
  await heartbeat(root, 'strategy', { mode: 'paper', healthy: false, note: 'tick failed' });
  console.error(`strategy tick failed: ${message}`); process.exit(1);
});
