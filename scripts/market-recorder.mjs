#!/usr/bin/env node
// Records a minute-by-minute market tape of fresh pump.fun coins so entry rules can be tested
// against what each coin actually did next (scripts/market-analyze.mjs). Read-only: public
// DexScreener data, no keys, no trading. One pass per run; launchd runs it every minute.
//   runtime/market/universe.json        mints being tracked and when each was first seen
//   runtime/market/tape-YYYY-MM-DD.jsonl one line per coin per minute
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const dir = join(root, 'market');
const DEX = 'https://api.dexscreener.com';
const TRACK_MS = 8 * 3600000, MAX_TRACKED = 300;
const get = async url => { const r = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) }); if (!r.ok) throw Error(`HTTP ${r.status}`); return r.json(); };
const pumpMint = a => typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && a.endsWith('pump');

/** New pump.fun mints from every public feed we can reach without keys. */
export async function discover() {
  const found = new Set();
  const feeds = [`${DEX}/token-profiles/latest/v1`, `${DEX}/token-boosts/latest/v1`, `${DEX}/token-boosts/top/v1`];
  for (const r of await Promise.allSettled(feeds.map(get)))
    if (r.status === 'fulfilled' && Array.isArray(r.value)) for (const t of r.value) if (t?.chainId === 'solana' && pumpMint(t.tokenAddress)) found.add(t.tokenAddress);
  for (const q of ['pump', 'pumpswap', 'pumpfun'])
    try { for (const p of (await get(`${DEX}/latest/dex/search?q=${q}`)).pairs || []) if (p.chainId === 'solana' && pumpMint(p.baseToken?.address)) found.add(p.baseToken.address); } catch {}
  return [...found];
}

/** One tape row per mint from its deepest pump.fun / PumpSwap SOL pair. */
export function rows(pairs, now) {
  const best = new Map();
  for (const p of pairs || []) {
    const mint = p?.baseToken?.address;
    if (!pumpMint(mint) || !['pumpfun', 'pumpswap'].includes(p.dexId) || p.quoteToken?.symbol !== 'SOL') continue;
    const prev = best.get(mint);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(mint, p);
  }
  return [...best.values()].map(p => ({
    t: now, mint: p.baseToken.address, sym: p.baseToken.symbol, dex: p.dexId,
    ageMin: p.pairCreatedAt ? Math.round((now - p.pairCreatedAt) / 60000) : null,
    price: Number(p.priceNative) || null, priceUsd: Number(p.priceUsd) || null,
    liq: p.liquidity?.usd ?? null, mc: p.marketCap ?? p.fdv ?? null,
    v5m: p.volume?.m5 ?? null, v1h: p.volume?.h1 ?? null, v24h: p.volume?.h24 ?? null,
    b5m: p.txns?.m5?.buys ?? null, s5m: p.txns?.m5?.sells ?? null, b1h: p.txns?.h1?.buys ?? null, s1h: p.txns?.h1?.sells ?? null,
    c5m: p.priceChange?.m5 ?? null, c1h: p.priceChange?.h1 ?? null, c6h: p.priceChange?.h6 ?? null,
  }));
}

async function tick() {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const now = Date.now(), uFile = join(dir, 'universe.json');
  let universe = {}; try { universe = JSON.parse(await readFile(uFile, 'utf8')); } catch {}
  for (const m of await discover()) universe[m] ??= now;
  // Track each coin for 8 hours after first sight; keep the newest when over the cap.
  const live = Object.entries(universe).filter(([, t]) => now - t < TRACK_MS).sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED);
  universe = Object.fromEntries(live);
  const mints = Object.keys(universe), out = [];
  for (let i = 0; i < mints.length; i += 30) {
    try { out.push(...rows(await get(`${DEX}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`), now)); } catch {}
  }
  const day = new Date(now).toISOString().slice(0, 10);
  if (out.length) await appendFile(join(dir, `tape-${day}.jsonl`), out.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  await writeFile(uFile + '.tmp', JSON.stringify(universe), { mode: 0o600 }); await rename(uFile + '.tmp', uFile);
  console.log(JSON.stringify({ tracked: mints.length, recorded: out.length }));
}

if (import.meta.url === `file://${process.argv[1]}`) tick().catch(e => { console.error(`market recorder: ${String(e?.message || e).slice(0, 120)}`); process.exit(1); });
