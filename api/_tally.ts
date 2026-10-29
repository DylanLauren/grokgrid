// Profit and loss from a bot's own verified trades. Every buy and sell in the store is a
// checked wallet movement (SOL out for a buy, SOL in for a sell), so this is wallet-true:
// a first buy's one-time account rent counts as cost. Sells realise against the average
// cost of the tokens still held, so partial sells work.

export interface Trade { side: 'buy' | 'sell'; mint: string; spentSol: number; sizeTokens?: number; ts: number }
export interface Tally { trades: number; closed: number; pnlSol: number | null; winRate: number | null; pnl: Map<Trade, number> }

export function tally(calls: Trade[]): Tally {
  const book = new Map<string, { tokens: number; cost: number }>()
  const pnl = new Map<Trade, number>()
  let wins = 0, realised = 0
  // the store keeps newest first
  for (const c of [...calls].sort((a, b) => a.ts - b.ts)) {
    const sol = Number(c.spentSol) || 0, tokens = Number(c.sizeTokens) || 0
    const b = book.get(c.mint) ?? { tokens: 0, cost: 0 }
    if (c.side === 'buy') {
      book.set(c.mint, { tokens: b.tokens + tokens, cost: b.cost + sol })
      continue
    }
    if (!(b.tokens > 0)) continue // a sell without a recorded buy has no cost to measure against
    const part = Math.min(1, tokens > 0 ? tokens / b.tokens : 1)
    const cost = b.cost * part
    const p = sol - cost
    pnl.set(c, p)
    realised += p
    if (p > 0) wins++
    book.set(c.mint, part >= 0.999 ? { tokens: 0, cost: 0 } : { tokens: b.tokens * (1 - part), cost: b.cost - cost })
  }
  return { trades: calls.length, closed: pnl.size, pnlSol: pnl.size ? realised : null, winRate: pnl.size ? (wins / pnl.size) * 100 : null, pnl }
}

/** A wallet curve from a bot's own verified trades, walked back from its balance now. Used
 * when no wallet snapshots were posted. Each step is the exact SOL that trade moved; deposits
 * and withdrawals are not trades, so the curve only covers the time since the first trade. */
export function curveFrom(calls: Trade[], solNow: number, now = Date.now()) {
  const pts: { ts: number; sol: number }[] = [{ ts: now, sol: solNow }]
  let sol = solNow
  for (const c of [...calls].sort((a, b) => b.ts - a.ts)) {
    pts.push({ ts: c.ts, sol: Math.max(0, sol) }) // just after this trade
    const v = Number(c.spentSol) || 0
    sol += c.side === 'buy' ? v : -v
  }
  if (calls.length) pts.push({ ts: pts[pts.length - 1].ts - 1, sol: Math.max(0, sol) }) // before the first
  return pts.reverse()
}
