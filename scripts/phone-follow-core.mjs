// Which pages the site's phone may show. The pinned window normally shows the house wallet's
// pump.fun profile; to let viewers watch the house trade, it may also show the pump.fun page of a
// coin the house holds or traded in the last few minutes. The phone guardian writes that list to
// runtime/phone-follow.json; the screenshot feed and the video capture accept a page only if it is
// the profile or on a fresh list. Window identity (window id, owner, size) is pinned separately.
export const FOLLOW_FILE = 'phone-follow.json';
export const FOLLOW_TTL_MS = 120_000;     // a list older than this allows only the profile
export const RECENT_TRADE_MS = 180_000;   // keep showing a coin this long after its last trade
const COIN = /^https:\/\/pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})$/;

export const coinUrl = mint => `https://pump.fun/coin/${mint}`;

/** Coins the phone may show: held now (finalized positions or a last reconciled buy) or traded recently. */
export function followMints(tradingState, positions, now) {
  const last = new Map();
  for (const i of [...(tradingState?.intents || [])].filter(i => ['reconciled-confirmed', 'held-ambiguous'].includes(i.state)).sort((a, b) => a.createdAt - b.createdAt)) last.set(i.mint, i);
  const out = [];
  for (const [mint, i] of last) if (i.side === 'buy' || now - i.createdAt < RECENT_TRADE_MS) out.push({ mint, at: i.createdAt });
  for (const p of positions?.positions || []) if (BigInt(p.tokenUnits) > 0n && !out.some(x => x.mint === p.mint)) out.push({ mint: p.mint, at: 0 });
  return out.sort((a, b) => b.at - a.at).map(x => x.mint);
}

/** The page the phone should show now: the newest followed coin, else the profile. */
export const targetPage = (mints, browserUrl) => (mints.length ? coinUrl(mints[0]) : browserUrl);

/** A page is allowed if it is the profile, or a coin page on a fresh follow list. */
export function pageAllowed(url, browserUrl, follow, now) {
  if (url === browserUrl) return true;
  const m = COIN.exec(typeof url === 'string' ? url : '');
  if (!m || !follow || !Array.isArray(follow.mints) || !Number.isSafeInteger(follow.updatedAt)) return false;
  return now - follow.updatedAt >= 0 && now - follow.updatedAt <= FOLLOW_TTL_MS && follow.mints.includes(m[1]);
}

/** Window titles: the pinned profile title, or any pump.fun page title. */
export const titleAllowed = (title, pinnedTitle) => title === pinnedTitle || (typeof title === 'string' && title.length <= 200 && title.endsWith(' | Pump'));
