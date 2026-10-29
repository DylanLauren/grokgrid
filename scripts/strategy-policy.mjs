// Strategy rules: pure functions over observed metrics. UNVALIDATED. The research in
// docs/research/2026-10-28-report.md picked no thresholds; these defaults encode its one testable
// hypothesis (small entries in liquid coins with rising genuine buyer activity) and are
// meant to be judged in paper mode first. Amounts in lamports are integer strings.
const num = x => typeof x === 'number' && Number.isFinite(x);
const frac = x => num(x) && x > 0 && x < 1;
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);

export const DEFAULT_STRATEGY = Object.freeze({
  version: 1,
  mode: 'paper',                 // 'paper' simulates fills; 'live' writes proposals for the executor
  flavor: 'momentum',
  minAgeMinutes: 10, maxAgeMinutes: 24 * 60,
  minLiquidityUsd: 15000, minMarketCapUsd: 30000, maxMarketCapUsd: 5_000_000,
  minVolume5mUsd: 3000, minVolume24hUsd: 50000,
  minBuys5m: 20, minBuySellRatio5m: 1.2,
  // Paper run 2026-10-29: 26 of 33 exits were stop-losses ~5 min after buying a spike, and
  // 8 coins were re-bought after stopping out. So: don't chase a 5m pump, and cool off a coin.
  maxChange5mPct: 25, reentryCooldownMinutes: 360,
  minHolders: 150, maxTop10Share: 0.30, maxDevShare: 0.05,
  maxTradeShareOfLiquidity: 0.01,
  tradeLamports: '50000000', maxOpenPositions: 3,
  takeProfit: 0.60, stopLoss: 0.25, trailArm: 0.25, trailStop: 0.20, maxHoldMinutes: 360,
  allowlistMinutes: 30, paperSlippage: 0.03, slippageBps: 1500, scanLimit: 30,
});

export function validateStrategyConfig(c) {
  if (!c || c.version !== 1 || !['paper', 'live'].includes(c.mode) || typeof c.flavor !== 'string') throw Error('Unsupported strategy config');
  for (const k of ['minAgeMinutes', 'maxAgeMinutes', 'minLiquidityUsd', 'minMarketCapUsd', 'maxMarketCapUsd', 'minVolume5mUsd', 'minVolume24hUsd', 'minBuys5m', 'minBuySellRatio5m', 'minHolders', 'maxHoldMinutes', 'allowlistMinutes', 'maxOpenPositions', 'scanLimit', 'maxChange5mPct', 'reentryCooldownMinutes'])
    if (!num(c[k]) || c[k] < 0) throw Error(`Invalid ${k}`);
  for (const k of ['maxTop10Share', 'maxDevShare', 'maxTradeShareOfLiquidity', 'takeProfit', 'stopLoss', 'trailArm', 'trailStop', 'paperSlippage']) if (!frac(c[k]) && !(k === 'takeProfit' && num(c[k]) && c[k] > 0)) throw Error(`Invalid ${k}`);
  if (c.minAgeMinutes >= c.maxAgeMinutes || c.minMarketCapUsd >= c.maxMarketCapUsd || !integer(c.tradeLamports) || BigInt(c.tradeLamports) <= 0n) throw Error('Invalid strategy ranges');
  if (!Number.isSafeInteger(c.slippageBps) || c.slippageBps < 1 || c.slippageBps > 2000 || !Number.isSafeInteger(c.maxOpenPositions) || c.maxOpenPositions < 1) throw Error('Invalid strategy limits');
  return c;
}

/** Per-agent rules may only tighten the global strategy, never loosen it. */
export function tighten(global, agent = {}) {
  const c = { ...global };
  const lower = (k, v) => { if (num(v) && v > 0) c[k] = Math.min(c[k], v); };
  const raise = (k, v) => { if (num(v) && v > 0) c[k] = Math.max(c[k], v); };
  if (integer(agent.tradeLamports) && BigInt(agent.tradeLamports) < BigInt(c.tradeLamports)) c.tradeLamports = agent.tradeLamports;
  lower('takeProfit', agent.takeProfit); lower('stopLoss', agent.stopLoss); lower('maxHoldMinutes', agent.maxHoldMinutes);
  lower('maxOpenPositions', agent.maxOpenPositions); raise('minLiquidityUsd', agent.minLiquidityUsd); raise('minHolders', agent.minHolders);
  if (typeof agent.flavor === 'string' && /^[a-z-]{1,24}$/.test(agent.flavor)) c.flavor = agent.flavor;
  return validateStrategyConfig(c);
}

/**
 * Screens one coin. `m` is a metrics snapshot (see strategy-data.mjs). Any missing fact
 * fails closed: an unknown holder count or authority never passes.
 */
export function screen(m, c, now) {
  const reasons = [];
  const need = (ok, why) => { if (!ok) reasons.push(why); };
  const age = num(m?.pairCreatedAt) ? (now - m.pairCreatedAt) / 60000 : NaN;
  need(m?.chainId === 'solana' && typeof m.mint === 'string', 'not-solana');
  need(num(age) && age >= c.minAgeMinutes && age <= c.maxAgeMinutes, 'age');
  need(num(m?.liquidityUsd) && m.liquidityUsd >= c.minLiquidityUsd, 'liquidity');
  need(num(m?.marketCapUsd) && m.marketCapUsd >= c.minMarketCapUsd && m.marketCapUsd <= c.maxMarketCapUsd, 'market-cap');
  need(num(m?.volume5mUsd) && m.volume5mUsd >= c.minVolume5mUsd, 'volume-5m');
  need(num(m?.volume24hUsd) && m.volume24hUsd >= c.minVolume24hUsd, 'volume-24h');
  need(num(m?.buys5m) && m.buys5m >= c.minBuys5m, 'buys-5m');
  need(num(m?.buys5m) && num(m?.sells5m) && m.buys5m / Math.max(1, m.sells5m) >= c.minBuySellRatio5m, 'buy-pressure');
  need(num(m?.change5m) && m.change5m <= c.maxChange5mPct, 'chasing-5m-pump');
  need(m?.mintAuthority === null && m?.freezeAuthority === null, 'authorities');
  need(num(m?.holders) && m.holders >= c.minHolders, 'holders');
  need(num(m?.top10Share) && m.top10Share <= c.maxTop10Share, 'concentration');
  need(num(m?.devShare) && m.devShare <= c.maxDevShare, 'dev-holding');
  need(num(m?.priceSol) && m.priceSol > 0 && num(m?.solUsd) && m.solUsd > 0, 'price');
  if (num(m?.liquidityUsd) && num(m?.solUsd)) need(Number(BigInt(c.tradeLamports)) / 1e9 * m.solUsd <= m.liquidityUsd * c.maxTradeShareOfLiquidity, 'trade-too-large-for-liquidity');
  return { ok: reasons.length === 0, reasons };
}

/** Exit rule for an open position, or null to hold. Price is SOL per raw token unit. */
export function exitDecision(p, priceSol, c, now, liquidating = false) {
  if (liquidating) return 'liquidate';
  if (!num(priceSol) || priceSol <= 0 || !num(p.entryPriceSol) || p.entryPriceSol <= 0) return null;
  const change = priceSol / p.entryPriceSol - 1, peak = Math.max(p.peakPriceSol || 0, priceSol);
  if (change >= c.takeProfit) return 'take-profit';
  if (change <= -c.stopLoss) return 'stop-loss';
  if (peak / p.entryPriceSol - 1 >= c.trailArm && priceSol <= peak * (1 - c.trailStop)) return 'trailing-stop';
  if (now - p.openedAt >= c.maxHoldMinutes * 60000) return 'max-hold';
  return null;
}

/** Expiring, filter-approved allowlist. Entries carry the screen's evidence. */
export function approve(allowlist, mint, c, now, evidence) {
  const live = pruneAllowlist(allowlist, now).filter(x => x.mint !== mint);
  return [...live, { mint, approvedAt: now, expiresAt: now + c.allowlistMinutes * 60000, evidence }];
}
export const pruneAllowlist = (allowlist, now) => (allowlist || []).filter(x => x.expiresAt > now);
export const allowed = (allowlist, mint, now) => pruneAllowlist(allowlist, now).some(x => x.mint === mint);
