import { mc } from './format'

type Fill = { side: 'buy' | 'sell'; mint: string; spentSol: number; sizeTokens?: number; tradeMc?: number; tradeMcApprox?: boolean }

// Average market cap he got in and out of each coin at, weighted by tokens traded
// (SOL when a trade has no token count), so two buys of one coin both count.
export interface AvgMc { entry?: number; exit?: number; approx: boolean }
export function avgMcs(trades: Fill[]): Map<string, AvgMc> {
  const acc = new Map<string, { b: [number, number]; s: [number, number]; approx: boolean }>()
  for (const t of trades) {
    if (!t.tradeMc) continue
    const w = t.sizeTokens || t.spentSol
    if (!(w > 0)) continue
    const a = acc.get(t.mint) ?? { b: [0, 0], s: [0, 0], approx: false }
    const side = t.side === 'buy' ? a.b : a.s
    side[0] += t.tradeMc * w
    side[1] += w
    a.approx ||= !!t.tradeMcApprox
    acc.set(t.mint, a)
  }
  return new Map([...acc].map(([m, a]) => [m, { entry: a.b[1] ? a.b[0] / a.b[1] : undefined, exit: a.s[1] ? a.s[0] / a.s[1] : undefined, approx: a.approx }]))
}
const avgOf = (n: number | undefined, approx: boolean) => (n ? `${approx ? '≈' : ''}${mc(n)}` : '–')
export const avgRows = (a?: AvgMc): [string, string][] => (a ? [['avg entry mc', avgOf(a.entry, a.approx)], ['avg exit mc', avgOf(a.exit, a.approx)]] : [])
