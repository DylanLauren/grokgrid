#!/usr/bin/env node
// Tests entry and exit rules against what coins in the recorded tape actually did next.
// Each rule takes at most one entry per coin (its first qualifying minute), fills at the
// observed price plus slippage, pays pump.fun-sized fees both ways, and exits on take-profit,
// stop-loss (filled at the minute the price is first seen past it, so gaps are real) or max
// hold. Rules are ranked on the earlier 70% of time and then checked on the later 30%.
//   node scripts/market-analyze.mjs [--min-trades 25] [--top 15]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SLIP = 0.03, FEE = 0.0125;
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };

export function series(lines) {
  const by = new Map();
  for (const r of lines) if (r.price > 0) (by.get(r.mint) || by.set(r.mint, []).get(r.mint)).push(r);
  for (const s of by.values()) s.sort((a, b) => a.t - b.t);
  return by;
}

/** Net return of one trade entered at s[i] under exit rule x. */
export function simulate(s, i, x) {
  const entry = s[i].price * (1 + SLIP), until = s[i].t + x.holdMin * 60000;
  let j = i + 1;
  for (; j < s.length && s[j].t <= until; j++) {
    const p = s[j].price;
    if (p >= entry * (1 + x.tp) || p <= entry * (1 - x.sl)) break;
  }
  if (j >= s.length || s[j].t > until) j = Math.max(i, j - 1);
  if (j === i) return null; // no later data yet
  const exit = s[j].price * (1 - SLIP);
  return { ret: (exit / entry) * (1 - FEE) * (1 - FEE) - 1, mins: (s[j].t - s[i].t) / 60000, reason: s[j].price >= entry * (1 + x.tp) ? 'tp' : s[j].price <= entry * (1 - x.sl) ? 'sl' : 'time' };
}

const between = (v, [lo, hi]) => v !== null && v !== undefined && v >= lo && v <= hi;
export function passes(r, f) {
  const ratio = r.b5m !== null && r.s5m !== null ? r.b5m / Math.max(1, r.s5m) : null;
  return between(r.ageMin, f.age) && (r.liq ?? 0) >= f.liq && between(r.mc, f.mc) && (r.v5m ?? 0) >= f.v5m && ratio !== null && ratio >= f.ratio && between(r.c5m, f.c5m) && between(r.c1h, f.c1h);
}

export function grid() {
  const F = [];
  for (const age of [[5, 60], [10, 240], [30, 480]]) for (const liq of [5000, 15000]) for (const mc of [[10000, 150000], [30000, 1000000], [100000, 5000000]])
    for (const v5m of [1000, 5000]) for (const ratio of [1, 1.3, 1.8]) for (const c5m of [[-15, 5], [0, 25], [10, 60]]) for (const c1h of [[-50, 0], [0, 100], [50, 1000]])
      F.push({ age, liq, mc, v5m, ratio, c5m, c1h });
  const X = [];
  for (const tp of [0.25, 0.5, 1]) for (const sl of [0.15, 0.25, 0.4]) for (const holdMin of [20, 60, 180]) X.push({ tp, sl, holdMin });
  return { F, X };
}

export function evaluate(by, f, x, from, to) {
  const rets = [];
  for (const s of by.values()) {
    const i = s.findIndex(r => r.t >= from && r.t < to && passes(r, f));
    if (i < 0) continue;
    const t = simulate(s, i, x); if (t) rets.push(t.ret);
  }
  if (!rets.length) return { n: 0 };
  const sorted = [...rets].sort((a, b) => a - b), mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return { n: rets.length, mean, median: sorted[Math.floor(sorted.length / 2)], win: rets.filter(r => r > 0).length / rets.length, worst: sorted[0], best: sorted.at(-1) };
}

async function main() {
  const dir = join(resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime')), 'market');
  const lines = [];
  for (const f of (await readdir(dir)).filter(f => f.startsWith('tape-'))) for (const l of (await readFile(join(dir, f), 'utf8')).split('\n')) if (l) lines.push(JSON.parse(l));
  const by = series(lines), ts = lines.map(r => r.t), t0 = Math.min(...ts), t1 = Math.max(...ts), cut = t0 + (t1 - t0) * 0.7;
  const { F, X } = grid(), minN = opt('--min-trades', 25), top = opt('--top', 15), results = [];
  for (const f of F) for (const x of X) { const a = evaluate(by, f, x, t0, cut); if (a.n >= minN) results.push({ f, x, train: a }); }
  results.sort((a, b) => b.train.mean - a.train.mean);
  const best = results.slice(0, top).map(r => ({ ...r, test: evaluate(by, r.f, r.x, cut, t1 + 1) }));
  const baseline = evaluate(by, { age: [0, 1e9], liq: 0, mc: [0, 1e12], v5m: 0, ratio: 0, c5m: [-1e9, 1e9], c1h: [-1e9, 1e9] }, { tp: 0.6, sl: 0.25, holdMin: 360 }, t0, t1 + 1);
  const report = { coins: by.size, rows: lines.length, hours: +((t1 - t0) / 3600000).toFixed(1), rulesTested: F.length * X.length, rulesWithEnoughTrades: results.length, baselineCurrentExits: baseline, best };
  await writeFile(join(dir, 'analysis.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, best: best.map(r => ({ entry: r.f, exit: r.x, train: fmt(r.train), test: fmt(r.test) })) }, null, 1));
}
const fmt = a => a.n ? { n: a.n, mean: +(a.mean * 100).toFixed(1), win: +(a.win * 100).toFixed(0), median: +(a.median * 100).toFixed(1) } : { n: 0 };

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`market analyze: ${e.message}`); process.exit(1); });
