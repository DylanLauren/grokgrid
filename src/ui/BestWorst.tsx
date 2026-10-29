import { solscan } from '../config'
import { ago, mc, usd } from '../lib/format'
import { CoinChip } from './CoinChip'
import { peek, type PeekCoin } from './CoinPeek'
import { avgRows, type AvgMc } from '../lib/avgMc'
export { avgMcs, avgRows, type AvgMc } from '../lib/avgMc'

// Every closed round trip: the sell, what it made, and how long he held.
// Live sells carry the SOL that came back; the demo story records what went in.
export interface Trade { ts: number; side: 'buy' | 'sell'; mint: string; symbol: string; name: string; image?: string; hue?: string; spentSol: number; sizeTokens?: number; positionUsd?: number | null; tradeMc?: number; tradeMcApprox?: boolean; pnlSol?: number | null; pnlUsd: number | null; sig?: string; coin?: { mcUsd: number; vol24hUsd: number; change24h: number } }
export interface Round { sell: Trade; buy?: Trade; pnl: number; cost: number; pct: number; held: number | null }

// The coin's market cap when he traded; ≈ marks an estimate from the fill price.
export const atMc = (t?: Trade) => (t?.tradeMc ? `${t.tradeMcApprox ? '≈' : ''}${mc(t.tradeMc)}` : '–')


export function rounds(trades: Trade[], live: boolean, solUsd: number): Round[] {
  const open = new Map<string, Trade>() // mint to the first buy of the holding
  const out: Round[] = []
  for (const c of [...trades].sort((a, b) => a.ts - b.ts)) {
    if (c.side === 'buy') {
      if (!open.has(c.mint)) open.set(c.mint, c)
      continue
    }
    const pnl = typeof c.pnlSol === 'number' ? c.pnlSol : c.pnlUsd !== null && solUsd ? c.pnlUsd / solUsd : null
    const start = open.get(c.mint)
    open.delete(c.mint)
    if (pnl === null || !Number.isFinite(pnl)) continue
    const cost = live ? c.spentSol - pnl : c.spentSol
    out.push({ sell: c, buy: start, pnl, cost, pct: cost > 0 ? (pnl / cost) * 100 : 0, held: start === undefined ? null : c.ts - start.ts })
  }
  return out
}

export const dur = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}
export const sol = (n: number, d = 4) => `${n >= 0 ? '+' : ''}${n.toFixed(d)} SOL`

// The best and worst closed trades, by return. Hover the coin for its card.
export function BestWorst({ done, solUsd, avg }: { done: Round[]; solUsd: number; avg?: Map<string, AvgMc> }) {
  const best = done.reduce((a, r) => (r.pct > a.pct ? r : a))
  const worst = done.reduce((a, r) => (r.pct < a.pct ? r : a))
  const pair: [string, Round][] = done.length > 1 ? [['best trade', best], ['worst trade', worst]] : [['only closed trade', best]]
  return (
      <div className={`st-bw ${pair.length === 1 ? 'one' : ''}`}>
        {pair.map(([label, r]) => {
          const c = r.sell
          const card: PeekCoin = {
            symbol: c.symbol, name: c.name, image: c.image, hue: c.hue ?? '#5a5a66', tag: label,
            ...(c.coin ?? {}),
            rows: [
              ['bought at', `${atMc(r.buy)} mc`],
              ['sold at', `${atMc(c)} mc`],
              ...avgRows(avg?.get(c.mint)),
              ['in', `${r.cost.toFixed(4)} SOL`],
              ['out', `${(r.cost + r.pnl).toFixed(4)} SOL`],
              ['realised', `${sol(r.pnl)} (${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(1)}%)`, r.pnl >= 0 ? 'gain' : 'loss'],
              ['held', r.held === null ? '–' : dur(r.held)],
              ['sold', ago(c.ts)],
            ],
          }
          return (
            <div key={label} className={`card st-bw-card ${r.pnl >= 0 ? 'up' : 'down'}`}>
              <span className="st-k mono">{label}</span>
              <span className="st-bw-coin" tabIndex={0} {...peek(card)}>
                <CoinChip call={{ symbol: c.symbol, image: c.image, hue: c.hue ?? '#5a5a66' }} size={44} />
                <span>
                  <b>${c.symbol}</b>
                  <small>{c.name}</small>
                </span>
              </span>
              <b className={`st-bw-pct ${r.pnl >= 0 ? 'gain' : 'loss'}`}>{r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%</b>
              <span className="st-bw-sub mono">
                <span className={r.pnl >= 0 ? 'gain' : 'loss'}>{sol(r.pnl)}</span>
                {(r.buy?.tradeMc || c.tradeMc) && <span>{atMc(r.buy)} → {atMc(c)} mc</span>}
                <span>{usd(Math.abs(r.pnl * solUsd))}</span>
                {r.held !== null && <span>held {dur(r.held)}</span>}
                {c.sig && <a className="sx" href={solscan('tx', c.sig)} target="_blank" rel="noreferrer" title="View on Solscan" aria-label="View on Solscan"><img src="/brands/solscan.svg" alt="" width={14} height={14} /></a>}
              </span>
            </div>
          )
        })}
      </div>
  )
}
