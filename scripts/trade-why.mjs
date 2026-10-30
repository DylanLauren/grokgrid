// The "why" behind each trade, in plain words, from the numbers the strategy decided on.
// No model or API: the strategy already knows why it bought or sold, this just says it.
// Whys live in a private file per writer (strategy, exit watcher, each bot), keyed by intent
// id, so the strict trading journal never changes shape and no two workers share a file.
import { join } from 'node:path';
import { readPrivateText, savePrivateJSON } from './runtime-observation-store.mjs';

const KEEP = 300;
const num = x => typeof x === 'number' && Number.isFinite(x);
const round = (x, d = 0) => (num(x) ? Number(x.toFixed(d)) : null);

/** Facts behind a buy, from the screened metrics snapshot; `style` is a user bot's trading style. */
export function buyWhy(m, now, style = null) {
  return { kind: 'buy', ratio: round(m.buys5m / Math.max(1, m.sells5m), 1), buys5m: round(m.buys5m), volume5mUsd: round(m.volume5mUsd),
    liquidityUsd: round(m.liquidityUsd), curveSol: round(m.curveSol, 1), marketCapUsd: round(m.marketCapUsd), holders: round(m.holders), top10Share: round(m.top10Share, 3),
    devShare: round(m.devShare, 3), change5m: round(m.change5m, 1), change1h: round(m.change1h, 1), ...(style ? { style } : {}), ageMin: num(m.pairCreatedAt) ? Math.max(0, Math.round((now - m.pairCreatedAt) / 60000)) : null };
}

/** Facts behind a sell: the exit rule that fired and the move that fired it. */
export function sellWhy(reason, { entryPriceSol, peakPriceSol, openedAt } = {}, priceSol, now) {
  const ok = num(entryPriceSol) && entryPriceSol > 0;
  return { kind: 'sell', reason, movePct: ok && num(priceSol) ? round((priceSol / entryPriceSol - 1) * 100) : null,
    peakPct: ok && num(peakPriceSol) && peakPriceSol > 0 ? round((peakPriceSol / entryPriceSol - 1) * 100) : null,
    heldMin: num(openedAt) ? Math.max(0, Math.round((now - openedAt) / 60000)) : null };
}

const usd = x => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${Math.round(x / 1e3)}k` : `$${Math.round(x)}`);
const pct = x => `${x >= 0 ? '+' : ''}${x}%`;
const span = m => (m >= 120 ? `${Math.round(m / 60)}h` : `${m}m`);

/** One or two first-person, lower-case sentences, like the rest of his notes. Null if there's nothing to say. */
export function whyText(why, coin = 'it') {
  if (why?.kind === 'buy') {
    const parts = [];
    // A styled bot leads with its style and the signal that style trades on.
    if (why.style === 'early') parts.push(`early style${num(why.ageMin) ? `, ${why.ageMin} min old` : ''}`);
    else if (why.style === 'momentum') parts.push(`momentum style${num(why.change5m) ? `, ${pct(why.change5m)} in 5m` : ''}`);
    else if (why.style === 'steady') parts.push(`steady style${num(why.change1h) ? `, ${pct(why.change1h)} in 1h` : ''}`);
    if (num(why.ratio)) parts.push(`buyers outpacing sellers ${why.ratio}×${num(why.buys5m) ? ` (${why.buys5m} buys in 5m)` : ''}`);
    if (num(why.liquidityUsd)) parts.push(`${usd(why.liquidityUsd)} liquidity`);
    else if (num(why.curveSol)) parts.push(`curve ${why.curveSol} SOL`); // a bonding-curve coin: its SOL is the liquidity
    if (num(why.holders)) parts.push(`${why.holders} holders`);
    if (num(why.top10Share)) parts.push(`top 10 hold ${Math.round(why.top10Share * 100)}%`);
    if (parts.length <= (why.style ? 1 : 0)) return null;
    const extra = [num(why.marketCapUsd) && `${usd(why.marketCapUsd)} mc`, why.style !== 'momentum' && num(why.change5m) && `${pct(why.change5m)} in 5m, not chasing`].filter(Boolean).join(', ');
    return `bought ${coin}: ${parts.join(', ')}.${extra ? ` ${extra}.` : ''}`;
  }
  if (why?.kind === 'sell') {
    const move = num(why.movePct) ? pct(why.movePct) : null, held = num(why.heldMin) ? ` after ${span(why.heldMin)}` : '';
    switch (why.reason) {
      case 'take-profit': return `sold ${coin}: took profit${move ? ` at ${move}` : ''}${held}.`;
      case 'stop-loss': return `sold ${coin}: stop-loss${move ? ` at ${move}` : ''}${held}, cutting it early.`;
      case 'trailing-stop': return `sold ${coin}: trailing stop${num(why.peakPct) ? `, peaked ${pct(why.peakPct)}` : ''}${move ? `, out at ${move}` : ''}${held}.`;
      case 'max-hold': return `sold ${coin}: max hold time reached${move ? ` at ${move}` : ''}${held}.`;
      case 'liquidate': return `sold ${coin}: winding down positions.`;
      default: return null;
    }
  }
  return null;
}

/** Adds whys (intent id -> why) to a writer's private file; keeps the newest few hundred. */
export async function recordWhys(file, whys, now = Date.now()) {
  const fresh = Object.entries(whys || {}).filter(([, w]) => w);
  if (!fresh.length) return;
  let book = {}; try { book = JSON.parse(await readPrivateText(file)).whys || {}; } catch {}
  for (const [id, w] of fresh) book[id] = { ...w, at: now };
  const kept = Object.entries(book).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, KEEP);
  await savePrivateJSON(file, { version: 1, whys: Object.fromEntries(kept) });
}

export const WHY_FILES = ['trade-why-strategy.json', 'trade-why-exit.json', 'trade-why.json'];

/** Every why a directory's writers recorded, merged. Missing files are fine. */
export async function readWhys(dir, files = WHY_FILES) {
  const out = new Map();
  for (const f of files) {
    try { for (const [id, w] of Object.entries(JSON.parse(await readPrivateText(join(dir, f))).whys || {})) out.set(id, w); } catch {}
  }
  return out;
}
