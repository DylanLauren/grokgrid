import { useMemo } from 'react'
import { stats } from '../data/useFeed'
import type { Feed } from '../data/types'
import { BOT_WALLET } from '../config'
import { pct, short } from '../lib/format'
import './monitor.css'

// The big screen on his desk: the wallet, drawn the way claudeonpump showed it.
export function MonitorScreen({ feed }: { feed: Feed }) {
  const s = stats(feed)
  const path = useMemo(() => {
    const pts = feed.curve
    if (pts.length < 2) return { line: '', area: '', lo: 0, hi: 0 }
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts
    const vals = pts.map((p) => p.sol)
    const lo = Math.min(...vals) * 0.96, hi = Math.max(...vals) * 1.04
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 700
    const y = (v: number) => 300 - ((v - lo) / (hi - lo || 1)) * 290
    // step line, like a wallet that only moves when he trades
    let line = `M0,${y(pts[0].sol)}`
    for (let i = 1; i < pts.length; i++) line += `H${x(pts[i].ts)}V${y(pts[i].sol)}`
    return { line, area: `${line}V300H0Z`, lo, hi }
  }, [feed.curve])

  return (
    <div className="mon">
      <div className="mon-head">
        <span className="mon-dot" />
        <span className="mono mon-label">his wallet</span>
        <span className="mono dim">{BOT_WALLET ? short(BOT_WALLET) : feed.mode === 'demo' ? 'demo' : ''}</span>
        <span className="mon-pills mono">
          <b className={s.pnl1h >= 0 ? 'gain' : 'loss'}>1h {pct(s.pnl1h)}</b>
          <b>6h</b>
          <b>all</b>
        </span>
      </div>
      <div className="mon-big">
        <span>{s.solNow.toFixed(3)}</span>
        <span className="mono dim">SOL</span>
      </div>
      <svg className="mon-chart" viewBox="0 0 700 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="mon-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[60, 120, 180, 240].map((y) => (
          <line key={y} x1="0" x2="700" y1={y} y2={y} stroke="#ffffff10" />
        ))}
        <path d={path.area} fill="url(#mon-fill)" />
        <path d={path.line} fill="none" stroke="#fff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mon-foot mono">
        <span>{s.trades} trades</span>
        <span>win rate {s.winRate.toFixed(0)}%</span>
        <span className="dim">{feed.calls[0] ? `last: ${feed.calls[0].side} ${feed.calls[0].symbol}` : ''}</span>
      </div>
    </div>
  )
}
