import { mc, usd } from '../lib/format'
import { CoinChip } from './CoinChip'
import { peek, type PeekCoin } from './CoinPeek'
import { atMc, avgRows, dur, sol, type AvgMc, type Trade } from './BestWorst'

// Coins he holds right now: every buy since his last sell of that coin.
export interface Open { buy: Trade; first: Trade; tokens: number; cost: number; since: number; value: number | null }
const SUPPLY = 1e9 // every pump.fun coin mints one billion tokens, so price = market cap / 1e9

export function positions(trades: Trade[], solUsd: number): Open[] {
  const held = new Map<string, Open>()
  for (const c of [...trades].sort((a, b) => a.ts - b.ts)) {
    if (c.side === 'sell') { held.delete(c.mint); continue }
    const o = held.get(c.mint)
    if (o) { o.tokens += c.sizeTokens ?? 0; o.cost += c.spentSol; o.buy = c }
    else held.set(c.mint, { buy: c, first: c, tokens: c.sizeTokens ?? 0, cost: c.spentSol, since: c.ts, value: null })
  }
  return [...held.values()].map((o) => {
    const mcUsd = o.buy.coin?.mcUsd
    // the labelled demo story records what its position is worth instead
    const value = mcUsd && o.tokens && solUsd ? (o.tokens * mcUsd) / SUPPLY / solUsd : o.buy.positionUsd && solUsd ? o.buy.positionUsd / solUsd : null
    return { ...o, value }
  }).sort((a, b) => b.since - a.since)
}

export function Positions({ open, solUsd, now = Date.now(), avg }: { open: Open[]; solUsd: number; now?: number; avg?: Map<string, AvgMc> }) {
  return (
    <div className="pos">
      {open.map((o) => {
        const c = o.buy
        const pnl = o.value === null ? null : o.value - o.cost
        const pct = pnl === null || !o.cost ? null : (pnl / o.cost) * 100
        const tone = pnl === null ? '' : pnl >= 0 ? 'gain' : 'loss'
        const card: PeekCoin = {
          symbol: c.symbol, name: c.name, image: c.image, hue: c.hue ?? '#5a5a66', tag: 'holding',
          ...(c.coin ?? {}),
          rows: [
            ['bought at', `${atMc(o.first)} mc`],
            ...avgRows(avg?.get(c.mint)),
            ['in', `${o.cost.toFixed(4)} SOL`],
            ['worth now', o.value === null ? '–' : `${o.value.toFixed(4)} SOL`],
            ['unrealised', pnl === null ? '–' : `${sol(pnl)} (${pct! >= 0 ? '+' : ''}${pct!.toFixed(1)}%)`, tone],
            ['held', dur(now - o.since)],
          ],
        }
        return (
          <div key={c.mint} className="card pos-row">
            <span className="st-bw-coin pos-coin" tabIndex={0} {...peek(card)}>
              <CoinChip call={{ symbol: c.symbol, image: c.image, hue: c.hue ?? '#5a5a66' }} size={36} />
              <span>
                <b>${c.symbol}</b>
                <small>{c.name}</small>
              </span>
            </span>
            <span className="pos-cell mono"><small>in</small>{o.cost.toFixed(4)}</span>
            <span className="pos-cell mono"><small>now</small>{o.value === null ? '–' : o.value.toFixed(4)}</span>
            <span className="pos-cell mono"><small>mc</small>{o.first.tradeMc ? `${atMc(o.first)} → ` : ''}{c.coin?.mcUsd ? mc(c.coin.mcUsd) : '–'}</span>
            <span className="pos-cell mono"><small>held</small>{dur(now - o.since)}</span>
            <b className={`pos-pct ${tone}`}>
              {pct === null ? '–' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
              {pnl !== null && <small className="mono">{usd(Math.abs(pnl * solUsd))}</small>}
            </b>
          </div>
        )
      })}
    </div>
  )
}
