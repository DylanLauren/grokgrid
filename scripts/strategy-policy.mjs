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

/**
 * User bots only buy coins still on pump.fun's bonding curve (their signer can't wrap SOL for
 * PumpSwap), and curve coins rarely reach the house's $15k liquidity / $30k market cap. With
 * `curveScreen` set, a curve coin is judged by these instead. Everything that guards against
 * rugs stays as strict as the house's: no authorities, top 10 ≤ 30%, dev ≤ 5%, buy pressure,
 * no chasing a 5m pump. The curve's own SOL is the liquidity: it is what a sell is paid from.
 * Money limits are untouched; trade size still comes from trade-budget.mjs and the policy.
 */
export const CURVE_SCREEN = Object.freeze({
  minAgeMinutes: 3,          // past the first-minutes sniper and bundle churn
  minMarketCapUsd: 10_000,   // above a fresh launch (~$4-6k)
  maxMarketCapUsd: 65_000,   // below graduation (~$70k+), so a buy doesn't land on the migration
  minCurveSol: 5,            // a 0.05 SOL trade stays ≤ 1% of what the curve can pay a sell from
  minHolders: 40,
  minVolume5mUsd: 1_000, minVolume24hUsd: 5_000, minBuys5m: 10,
});

/**
 * Trading styles a launcher picks for a user bot. Each is a variant of the curve screen with its
 * own exits; every rug check (no authorities, top 10 ≤ 30%, dev ≤ 5%, curve SOL ≥ 5, no +25% 5m
 * chase) and every money limit stays the same. An owner's take-profit / stop-loss apply only when
 * tighter. A bot with no style is 'steady'.
 *   early     young coins with strong early buying; quick, small exits
 *   momentum  coins already moving up with heavy buying; medium exits
 *   steady    settled curve coins (15+ min, 70+ holders) with a rising hour; the house's exits
 */
export const STYLES = Object.freeze({
  early: Object.freeze({
    screen: { minMarketCapUsd: 10_000, maxMarketCapUsd: 30_000, minAgeMinutes: 3, maxAgeMinutes: 20, minHolders: 40, minBuySellRatio5m: 1.3, minBuys5m: 12 },
    exits: { takeProfit: 0.35, stopLoss: 0.15, trailArm: 0.15, trailStop: 0.12, maxHoldMinutes: 60 },
  }),
  momentum: Object.freeze({
    screen: { minMarketCapUsd: 20_000, maxMarketCapUsd: 65_000, minAgeMinutes: 5, minHolders: 60, minBuySellRatio5m: 1.5, minChange5mPct: 5, minVolume5mUsd: 2_000 },
    exits: { takeProfit: 0.45, stopLoss: 0.20, trailArm: 0.20, trailStop: 0.15, maxHoldMinutes: 120 },
  }),
  // Curve coins top out near $65-70k mc, so steady wants the settled part of the curve, not
  // graduated-coin maturity: 15+ minutes, 70+ holders, a rising hour.
  steady: Object.freeze({
    screen: { minMarketCapUsd: 25_000, maxMarketCapUsd: 65_000, minAgeMinutes: 15, minHolders: 70, minBuySellRatio5m: 1.2, minChange1hPct: 0 },
    exits: { takeProfit: 0.60, stopLoss: 0.25, trailArm: 0.25, trailStop: 0.20, maxHoldMinutes: 360 },
  }),
});
export const styleOf = s => (typeof s === 'string' && Object.hasOwn(STYLES, s) ? s : 'steady');

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
  // A bonding-curve coin under a curve screen: same checks, curve-sized floors (CURVE_SCREEN).
  const curve = c.curveScreen === true && m?.dexId === 'pumpfun';
  if (curve) c = { ...c, ...CURVE_SCREEN, ...(c.style ? STYLES[styleOf(c.style)].screen : {}) };
  const reasons = [];
  const need = (ok, why) => { if (!ok) reasons.push(why); };
  const age = num(m?.pairCreatedAt) ? (now - m.pairCreatedAt) / 60000 : NaN;
  need(m?.chainId === 'solana' && typeof m.mint === 'string', 'not-solana');
  need(num(age) && age >= c.minAgeMinutes && age <= c.maxAgeMinutes, 'age');
  if (curve) need(num(m?.curveSol) && m.curveSol >= c.minCurveSol, 'curve-sol');
  else need(num(m?.liquidityUsd) && m.liquidityUsd >= c.minLiquidityUsd, 'liquidity');
  need(num(m?.marketCapUsd) && m.marketCapUsd >= c.minMarketCapUsd && m.marketCapUsd <= c.maxMarketCapUsd, 'market-cap');
  need(num(m?.volume5mUsd) && m.volume5mUsd >= c.minVolume5mUsd, 'volume-5m');
  need(num(m?.volume24hUsd) && m.volume24hUsd >= c.minVolume24hUsd, 'volume-24h');
  need(num(m?.buys5m) && m.buys5m >= c.minBuys5m, 'buys-5m');
  need(num(m?.buys5m) && num(m?.sells5m) && m.buys5m / Math.max(1, m.sells5m) >= c.minBuySellRatio5m, 'buy-pressure');
  need(num(m?.change5m) && m.change5m <= c.maxChange5mPct, 'chasing-5m-pump');
  if (curve && num(c.minChange5mPct)) need(num(m?.change5m) && m.change5m >= c.minChange5mPct, 'not-moving');
  if (curve && num(c.minChange1hPct)) need(num(m?.change1h) && m.change1h > c.minChange1hPct, 'hour-not-rising');
  need(m?.mintAuthority === null && m?.freezeAuthority === null, 'authorities');
  need(num(m?.holders) && m.holders >= c.minHolders, 'holders');
  need(num(m?.top10Share) && m.top10Share <= c.maxTop10Share, 'concentration');
  need(num(m?.devShare) && m.devShare <= c.maxDevShare, 'dev-holding');
  need(num(m?.priceSol) && m.priceSol > 0 && num(m?.solUsd) && m.solUsd > 0, 'price');
  const depthUsd = curve ? (num(m?.curveSol) && num(m?.solUsd) ? m.curveSol * m.solUsd : NaN) : m?.liquidityUsd;
  if (num(depthUsd) && num(m?.solUsd)) need(Number(BigInt(c.tradeLamports)) / 1e9 * m.solUsd <= depthUsd * c.maxTradeShareOfLiquidity, 'trade-too-large-for-liquidity');
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
