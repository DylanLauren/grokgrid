#!/usr/bin/env node
// Backfills a historical tape from GeckoTerminal's public minute candles so entry and exit rules
// can be tested on days of past pump.fun coins instead of waiting for the live recorder.
// Read-only, no keys. Candles carry price and volume only: liquidity and buy/sell counts are
// null, so rules that need them fail closed (scripts/market-analyze.mjs --source backfill
// tests rules without them). Market cap assumes pump.fun's fixed 1B supply.
//   node scripts/market-backfill.mjs [--pools 600]
//   runtime/market/backfill-gt.jsonl  one row per coin per traded minute
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const dir = join(resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime')), 'market');
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana';
const SUPPLY = 1e9, GAP_MS = 2600; // free tier allows ~30 calls a minute
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
async function get(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(Math.max(0, last + GAP_MS - Date.now())); last = Date.now();
    const r = await fetch(GT + path, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (r.status === 429) { await sleep(30000 * (attempt + 1)); continue; }
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw Error('rate limited');
}

/** Pump.fun curve and PumpSwap pools from several listings, so the sample is not only today's winners. */
async function listPools(max) {
  const pools = new Map(), add = d => { for (const p of d?.data || []) {
    const dex = p.relationships?.dex?.data?.id, mint = p.relationships?.base_token?.data?.id?.replace(/^solana_/, '');
    if (['pump-fun', 'pumpswap'].includes(dex) && mint?.endsWith('pump') && !pools.has(p.attributes.address))
      pools.set(p.attributes.address, { pool: p.attributes.address, mint, dex, sym: p.attributes.name?.split(' / ')[0], createdAt: Date.parse(p.attributes.pool_created_at) });
  } };
  const lists = [];
  for (const dex of ['pump-fun', 'pumpswap']) for (const sort of ['h24_tx_count_desc', 'h24_volume_usd_desc']) lists.push(page => `/dexes/${dex}/pools?page=${page}&sort=${sort}`);
  lists.push(page => `/new_pools?page=${page}`, page => `/trending_pools?page=${page}&duration=6h`);
  for (let page = 1; page <= 10 && pools.size < max; page++) for (const l of lists) { try { add(await get(l(page))); } catch {} if (pools.size >= max) break; }
  return [...pools.values()].slice(0, max);
}

/** Tape rows from oldest-first candles [ts, o, h, l, c, volUsd], with trailing 5m/1h windows. */
export function candleRows(meta, candles) {
  const c = [...candles].sort((a, b) => a[0] - b[0]), out = [];
  const before = (i, ms) => { let k = i; while (k > 0 && c[k - 1][0] * 1000 > c[i][0] * 1000 - ms) k--; return k; };
  for (let i = 0; i < c.length; i++) {
    const t = c[i][0] * 1000, price = c[i][4];
    if (!(price > 0)) continue;
    const k5 = before(i, 5 * 60000), k60 = before(i, 60 * 60000);
    const ref = (k, ms) => k > 0 ? c[k - 1][4] : (t - c[0][0] * 1000 >= ms ? c[0][1] : null); // close before the window
    const pct = (k, ms) => { const r = ref(k, ms); return r > 0 ? +((price / r - 1) * 100).toFixed(2) : null; };
    const vol = k => c.slice(k, i + 1).reduce((s, x) => s + x[5], 0);
    out.push({ t, mint: meta.mint, sym: meta.sym, dex: meta.dex, src: 'gt',
      ageMin: Number.isFinite(meta.createdAt) ? Math.round((t - meta.createdAt) / 60000) : null,
      price, priceUsd: price, liq: null, mc: price * SUPPLY,
      v5m: +vol(k5).toFixed(2), v1h: +vol(k60).toFixed(2), v24h: null,
      b5m: null, s5m: null, b1h: null, s1h: null, c5m: pct(k5, 5 * 60000), c1h: pct(k60, 60 * 60000), c6h: null });
  }
  return out;
}

async function main() {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const doneFile = join(dir, 'backfill-done.json'), out = join(dir, 'backfill-gt.jsonl');
  let done = {}; try { done = JSON.parse(await readFile(doneFile, 'utf8')); } catch {}
  const pools = (await listPools(opt('--pools', 600))).filter(p => !done[p.pool]);
  console.log(JSON.stringify({ pools: pools.length, skippedAlreadyDone: Object.keys(done).length }));
  let n = 0, rowsOut = 0;
  for (const p of pools) {
    try {
      const d = await get(`/pools/${p.pool}/ohlcv/minute?aggregate=1&limit=1000&currency=usd`);
      const r = candleRows(p, d?.data?.attributes?.ohlcv_list || []);
      if (r.length) await appendFile(out, r.map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
      rowsOut += r.length; done[p.pool] = Date.now();
    } catch (e) { console.error(`backfill ${p.pool}: ${String(e?.message || e).slice(0, 80)}`); }
    if (++n % 25 === 0) { await writeFile(doneFile, JSON.stringify(done)); console.log(JSON.stringify({ n, rowsOut })); }
  }
  await writeFile(doneFile, JSON.stringify(done));
  console.log(JSON.stringify({ n, rowsOut }));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`market backfill: ${e.message}`); process.exit(1); });
