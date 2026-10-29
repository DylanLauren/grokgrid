import { useMemo, useState } from 'react'
import { MAIN_TICKER, solscan } from '../config'
import type { Feed } from '../data/types'
import { stats } from '../data/useFeed'
import { useToken, type GridToken } from '../data/useToken'
import { useWorkers, type WorkerName, type Workers } from '../data/useWorkers'
import { ago, mc, pct, signedUsd, usd } from '../lib/format'
import { CoinChip } from '../ui/CoinChip'
import { Addresses } from '../ui/Panels'
import { Page, Section } from './Page'

export function StatsPage({ feed }: { feed: Feed }) {
  const s = stats(feed)
  const token = useToken(true)
  const workers = useWorkers(true)
  const burned = token?.burned ?? feed.burnedMain
  const tiles: [string, string, string?, string?][] = [
    ['trades', `${s.trades}`, `${feed.calls.filter((c) => c.side === 'sell').length} closed`],
    ['win rate', `${(s.winRate === null ? '–' : s.winRate.toFixed(0))}%`, 'of closed trades'],
    ['best trade', s.best ? signedUsd(s.best.pnlUsd) : '–', s.best?.symbol, 'gain'],
    ['worst trade', s.worst ? signedUsd(s.worst.pnlUsd) : '–', s.worst?.symbol, 'loss'],
    ['fees in', `${feed.feesSol.toFixed(2)}`, 'SOL from creator fees'],
    [`$${MAIN_TICKER} burned`, burned ? compact(burned) : '0', token?.burned != null ? 'gone from supply, on chain' : 'bought and burned'],
  ]
  return (
    <Page
      say="i win some. i lose some."
      n={3}
      label="stats"
      title="His numbers"
      sub={feed.mode === 'live' ? 'read from his wallet on chain, not from us. every trade links to its transaction.' : 'his wallet goes on chain at launch. until then, this is a sample of what he will look like.'}
      side={feed.mode === 'live' && <span className="live-pill"><i />live</span>}
    >
      <div className="st-hero">
        <div className="card st-wallet">
          <span className="st-k mono">wallet</span>
          <div className="st-big">
            {s.solNow.toFixed(3)}
            <small className="mono">SOL</small>
          </div>
          <span className="st-usd mono">{usd(s.usdNow)}</span>
          <div className="st-pills mono">
            <span className={s.pnl1h >= 0 ? 'gain' : 'loss'}>1h {pct(s.pnl1h)}</span>
            <span className={s.pnl24h >= 0 ? 'gain' : 'loss'}>24h {pct(s.pnl24h)}</span>
            <span className={s.pnlAll >= 0 ? 'gain' : 'loss'}>all {pct(s.pnlAll)}</span>
          </div>
        </div>
        <WalletChart feed={feed} />
      </div>

      <div className="st-tiles">
        {tiles.map(([k, v, sub, tone]) => (
          <div className="card st-tile" key={k}>
            <span className="st-k mono">{k}</span>
            <b className={tone ?? ''}>{v}</b>
            {sub && <small className="mono">{sub}</small>}
          </div>
        ))}
      </div>

      <Section title="Recent trades" note={`${Math.min(14, feed.calls.length)} of ${feed.calls.length}`}>
        <div className="st-trades" role="table">
          <div className="st-tr th mono" role="row">
            <span />
            <span>coin</span>
            <span>side</span>
            <span className="r">spent</span>
            <span className="r">mc</span>
            <span className="r">p&l</span>
            <span className="r">when</span>
            <span />
          </div>
          {feed.calls.slice(0, 14).map((c) => (
            <div className="st-tr" role="row" key={c.id}>
              <CoinChip call={c} size={34} />
              <span className="st-coin">
                <span>
                  <b>${c.symbol}</b>
                  <small>{c.name}</small>
                </span>
              </span>
              <em className={`mono ${c.side}`}>{c.side}</em>
              <span className="r mono">{c.spentSol} SOL</span>
              <span className="r mono">{mc(c.nowMc)}</span>
              <span className={`r mono ${c.side === 'buy' ? 'dim' : c.pnlUsd === null ? 'dim' : c.pnlUsd >= 0 ? 'gain' : 'loss'}`}>{c.side === 'buy' ? '–' : signedUsd(c.pnlUsd)}</span>
              <span className="r mono dim">{ago(c.ts)}</span>
              {c.sig ? (
                <a href={solscan('tx', c.sig)} target="_blank" rel="noreferrer" title="transaction on Solscan">↗</a>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </Section>

      {token?.onChain && <GridSection token={token} />}

      {workers && <WorkersSection workers={workers} />}

      <Section title="Addresses">
        <Addresses />
      </Section>
    </Page>
  )
}

const WORKERS: [WorkerName, string][] = [
  ['trading', 'house trader'],
  ['strategy', 'coin picker'],
  ['agent-runner', 'bot runner'],
  ['buyback', 'buy and burn'],
  ['phone', 'phone feed'],
]
const MODE: Record<string, string> = { execute: 'trading for real', paper: 'practice mode', 'observe-only': 'watching only' }

// Every worker reports in each minute. Offline means no report in the last two minutes.
function WorkersSection({ workers }: { workers: Workers }) {
  const up = WORKERS.filter(([k]) => workers[k]?.online).length
  return (
    <Section title="Workers" note={`${up} of ${WORKERS.length} online`}>
      <div className="st-tiles st-tiles-5">
        {WORKERS.map(([k, label]) => {
          const w = workers[k]
          const agents = k === 'agent-runner' && w?.online && w.agents !== null ? ` · ${w.agents} bots` : ''
          return (
            <div className="card st-tile" key={k}>
              <span className="st-k mono">{label}</span>
              <b className={w?.online ? 'st-up' : 'st-down'}>{w?.online ? 'online' : 'offline'}</b>
              <small className="mono">{w?.online ? `${MODE[w.mode ?? ''] ?? w.mode}${agents}` : w?.seenAt ? `last seen ${ago(w.seenAt)}` : 'not started yet'}</small>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// $GRID itself, every number read off the chain (price from DexScreener).
function GridSection({ token }: { token: GridToken }) {
  const pct = token.burned !== null ? (token.burned / token.startSupply) * 100 : null
  const rows: [string, string, string?][] = [
    ['market cap', token.market ? mc(token.market.mcUsd) : '–', token.market ? `24h ${token.market.change24h >= 0 ? '+' : ''}${token.market.change24h.toFixed(1)}%` : 'no market yet'],
    ['24h volume', token.market ? mc(token.market.vol24hUsd) : '–'],
    ['supply', token.supply !== null ? compact(token.supply) : '–', `of ${compact(token.startSupply)} at launch`],
    ['burned', token.burned !== null ? compact(token.burned) : '–', pct !== null ? `${pct < 0.01 && pct > 0 ? '<0.01' : pct.toFixed(2)}% of supply` : undefined],
    ['treasury', token.treasury?.sol != null ? `${token.treasury.sol.toFixed(3)} SOL` : '–', '80% of fees, funds the bots'],
    ['burn wallet', token.burnWallet?.sol != null ? `${token.burnWallet.sol.toFixed(3)} SOL` : '–', '20% of fees, waiting to buy and burn'],
  ]
  return (
    <Section title={`$${MAIN_TICKER} on chain`} note={token.locked ? 'mint and freeze revoked' : token.locked === false ? 'mint authority still set' : undefined}>
      <div className="st-tiles">
        {rows.map(([k, v, sub]) => (
          <div className="card st-tile" key={k}>
            <span className="st-k mono">{k}</span>
            <b>{v}</b>
            {sub && <small className="mono">{sub}</small>}
          </div>
        ))}
      </div>
    </Section>
  )
}

// His wallet over time. Hover anywhere on it to read the balance at that moment.
function WalletChart({ feed }: { feed: Feed }) {
  const [hover, setHover] = useState<number | null>(null)
  const g = useMemo(() => {
    const pts = feed.curve
    if (pts.length < 2) return null
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts
    const vals = pts.map((p) => p.sol)
    const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 1000
    const y = (v: number) => 300 - ((v - lo) / (hi - lo || 1)) * 290
    let line = `M0,${y(pts[0].sol)}`
    for (let i = 1; i < pts.length; i++) line += `H${x(pts[i].ts)}V${y(pts[i].sol)}`
    return { line, area: `${line}V300H0Z`, x, y, pts }
  }, [feed.curve])
  if (!g) return <div className="card st-chart" />
  const p = hover !== null ? g.pts[hover] : g.pts[g.pts.length - 1]
  return (
    <div className="card st-chart">
      <div className="st-chart-top mono">
        <span>wallet, last {Math.max(1, Math.round((g.pts[g.pts.length - 1].ts - g.pts[0].ts) / 3.6e6))}h</span>
        <span>
          <b>{p.sol.toFixed(3)} SOL</b> · {new Date(p.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      <div className="st-plot">
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const t = g.pts[0].ts + ((e.clientX - r.left) / r.width) * (g.pts[g.pts.length - 1].ts - g.pts[0].ts)
          let i = 0
          while (i < g.pts.length - 1 && g.pts[i + 1].ts <= t) i++
          setHover(i)
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="st-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[75, 150, 225].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="#ffffff0d" />)}
        <path d={g.area} fill="url(#st-fill)" />
        <path d={g.line} fill="none" stroke="#fff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={g.x(p.ts)} x2={g.x(p.ts)} y1="0" y2="300" stroke="#ffffff40" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && <i className="st-dot" style={{ left: `${g.x(p.ts) / 10}%`, top: `${g.y(p.sol) / 3}%` }} />}
      </div>
    </div>
  )
}

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`)
