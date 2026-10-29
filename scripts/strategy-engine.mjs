import { randomUUID } from 'node:crypto';
import { screen, exitDecision, approve, pruneAllowlist } from './strategy-policy.mjs';

// One strategy pass. Paper mode simulates fills against observed prices and keeps its own
// journal. Live mode returns proposals for the existing planIntent path; it signs nothing.
const PUMP_FEE = 0.0125; // per side, a rough pump.fun/PumpSwap fee+creator share for paper fills
const LOG_LIMIT = 300;

export function emptyPaper(bankrollLamports = '1000000000') {
  return { version: 1, revision: 0, startedLamports: bankrollLamports, cashLamports: bankrollLamports, positions: [], closed: [], allowlist: [], log: [] };
}
const lamports = sol => BigInt(Math.max(0, Math.floor(sol * 1e9)));
const log = (s, now, line) => { s.log = [...s.log, { at: now, line }].slice(-LOG_LIMIT); };

/** Rank screened coins: most 5m buy pressure per unit of liquidity first. */
function entries(market, c, now, held) {
  const picks = [];
  for (const [mint, m] of market.metrics) {
    if (held.has(mint)) continue;
    const facts = market.facts.get(mint);
    const merged = { ...m, ...(facts || {}) };
    const verdict = facts ? screen(merged, c, now) : { ok: false, reasons: ['chain-facts-unavailable'] };
    if (verdict.ok) picks.push({ mint, m: merged, score: (m.buys5m / Math.max(1, m.sells5m)) * (m.volume5mUsd / m.liquidityUsd) });
  }
  return picks.sort((a, b) => b.score - a.score);
}

export function paperTick(prev, c, market, now, liquidating = false) {
  const s = structuredClone(prev);
  s.allowlist = pruneAllowlist(s.allowlist, now);
  // Exits first, so a position closed this tick frees its slot.
  for (const p of [...s.positions]) {
    const price = market.metrics.get(p.mint)?.priceSol ?? market.prices?.get(p.mint);
    p.peakPriceSol = Math.max(p.peakPriceSol, price || 0);
    const reason = exitDecision(p, price, c, now, liquidating);
    if (!reason || !(price > 0)) continue;
    const proceeds = lamports(p.tokens * price * (1 - c.paperSlippage) * (1 - PUMP_FEE));
    s.cashLamports = (BigInt(s.cashLamports) + proceeds).toString();
    s.positions = s.positions.filter(x => x.id !== p.id);
    const pnl = proceeds - BigInt(p.costLamports);
    s.closed = [...s.closed, { ...p, exitPriceSol: price, closedAt: now, reason, proceedsLamports: proceeds.toString(), pnlLamports: pnl.toString() }].slice(-1000);
    log(s, now, `sold ${p.symbol} (${reason}) ${Number(pnl) >= 0 ? '+' : ''}${(Number(pnl) / 1e9).toFixed(4)} SOL`);
  }
  if (!liquidating && s.positions.length < c.maxOpenPositions && BigInt(s.cashLamports) >= BigInt(c.tradeLamports)) {
    const [pick] = entries(market, c, now, new Set(s.positions.map(p => p.mint)));
    if (pick) {
      s.allowlist = approve(s.allowlist, pick.mint, c, now, { liquidityUsd: pick.m.liquidityUsd, holders: pick.m.holders, top10Share: pick.m.top10Share });
      const spend = Number(BigInt(c.tradeLamports)) / 1e9, fill = pick.m.priceSol * (1 + c.paperSlippage);
      const tokens = spend * (1 - PUMP_FEE) / fill;
      s.cashLamports = (BigInt(s.cashLamports) - BigInt(c.tradeLamports)).toString();
      s.positions = [...s.positions, { id: randomUUID(), mint: pick.mint, symbol: pick.m.symbol, openedAt: now, entryPriceSol: fill, peakPriceSol: fill, tokens, costLamports: c.tradeLamports }];
      log(s, now, `bought ${pick.m.symbol} for ${spend} SOL (liq $${Math.round(pick.m.liquidityUsd)}, ${pick.m.holders}+ holders)`);
    }
  }
  s.revision += 1;
  return s;
}

export function paperSummary(s, market) {
  const open = s.positions.reduce((n, p) => n + (market?.metrics.get(p.mint)?.priceSol ?? p.entryPriceSol) * p.tokens, 0);
  const wins = s.closed.filter(x => BigInt(x.pnlLamports) > 0n).length;
  const equity = Number(BigInt(s.cashLamports)) / 1e9 + open;
  return { equitySol: equity, startedSol: Number(BigInt(s.startedLamports)) / 1e9, closedTrades: s.closed.length, winRate: s.closed.length ? wins / s.closed.length : null,
    realizedSol: s.closed.reduce((n, x) => n + Number(BigInt(x.pnlLamports)), 0) / 1e9, openPositions: s.positions.length };
}

/** Weighted cost basis per mint from finalized, reconciled buys (SOL per UI token). */
export function costBasis(tradingState, decimalsByMint) {
  const acc = new Map();
  for (const i of tradingState.intents) {
    if (i.state !== 'reconciled-confirmed' || i.side !== 'buy') continue;
    const d = decimalsByMint.get(i.mint); if (!Number.isInteger(d)) continue;
    const a = acc.get(i.mint) || { sol: 0, tokens: 0, openedAt: i.createdAt };
    a.sol += Number(BigInt(i.receipt.spentLamports)) / 1e9; a.tokens += Number(BigInt(i.receipt.receivedTokenUnits)) / 10 ** d;
    a.openedAt = Math.min(a.openedAt, i.createdAt); acc.set(i.mint, a);
  }
  return new Map([...acc].map(([mint, a]) => [mint, { entryPriceSol: a.sol / a.tokens, openedAt: a.openedAt }]));
}

/**
 * Live planning. Returns the allowlist to store and at most one exit plus one entry
 * proposal per tick. Exits use finalized balances and the reconciled cost basis; a held
 * token with no reconciled buy has no basis and only exits on liquidation.
 */
export function livePlan({ tradingState, policy, c, peaks, positions, market, now, liquidating }) {
  const proposals = [], nextPeaks = { ...peaks };
  const basis = costBasis(tradingState, new Map((positions.positions || []).map(p => [p.mint, p.decimals])));
  const busy = new Set(tradingState.intents.filter(i => ['planned', 'held-ambiguous', 'blocked-execution-disabled'].includes(i.state)).map(i => i.mint));
  const base = { agentId: policy.agentId, wallet: policy.wallet, slippageBps: Math.min(c.slippageBps, policy.maxSlippageBps), createdAt: now, expiresAt: now + Math.min(policy.maxIntentAgeMs, 45000) };
  for (const p of positions.positions || []) {
    if (BigInt(p.spendableTokenUnits) === 0n || busy.has(p.mint)) continue;
    const price = market.metrics.get(p.mint)?.priceSol ?? market.prices?.get(p.mint);
    const b = basis.get(p.mint);
    nextPeaks[p.mint] = Math.max(nextPeaks[p.mint] || 0, price || 0);
    const reason = liquidating ? 'liquidate' : b ? exitDecision({ ...b, peakPriceSol: nextPeaks[p.mint] }, price, c, now) : null;
    if (!reason || !(price > 0)) continue;
    // The floor comes from an on-chain quote on the sell's own route. A DexScreener price
    // that disagrees with it by more than 15% is not trusted to plan anything.
    const quoted = market.sellQuotes?.get(p.mint);
    if (!quoted || BigInt(quoted) <= 0n) continue;
    const dexExpected = Number(BigInt(p.spendableTokenUnits)) / 10 ** p.decimals * price * 1e9;
    if (Math.abs(dexExpected - Number(BigInt(quoted))) > 0.15 * Number(BigInt(quoted))) continue;
    const floor = BigInt(quoted) * BigInt(10000 - base.slippageBps) / 10000n;
    if (floor <= 0n) continue;
    proposals.push({ ...base, id: `sell-${randomUUID()}`, mint: p.mint, side: 'sell', tokenUnits: p.spendableTokenUnits, tokenDecimals: p.decimals, minimumReceiveLamports: floor.toString(), reason });
    break;
  }
  let allowlist = pruneAllowlist(tradingState.allowlist, now);
  const held = new Set([...(positions.positions || []).filter(p => BigInt(p.tokenUnits) > 0n).map(p => p.mint), ...busy]);
  if (!liquidating && held.size < c.maxOpenPositions) {
    const [pick] = entries(market, c, now, held);
    if (pick) {
      allowlist = approve(allowlist, pick.mint, c, now, {});
      const spend = BigInt(c.tradeLamports) < BigInt(policy.maxTradeLamports) ? c.tradeLamports : policy.maxTradeLamports;
      proposals.push({ ...base, id: `buy-${randomUUID()}`, mint: pick.mint, side: 'buy', spendLamports: spend, reason: 'screen-passed' });
    }
  }
  for (const k of Object.keys(nextPeaks)) if (!(positions.positions || []).some(p => p.mint === k)) delete nextPeaks[k];
  return { allowlist, proposals, peaks: nextPeaks };
}
