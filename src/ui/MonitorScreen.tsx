import { useEffect, useMemo, useState } from 'react'
import { stats } from '../data/useFeed'
import type { Call, Feed, Live } from '../data/types'
import { BOT_WALLET } from '../config'
import { mc, pct, short } from '../lib/format'
import { CoinChip } from './CoinChip'
import { BotMark } from './BotMark'
import './monitor.css'

// The big screen on his desk: a real looking desktop with the coin he is in, his wallet
// and Grok Bot's own log of what it is doing. Glass, glare and pixel grid sit on top.
export function MonitorScreen({ feed, live }: { feed: Feed; live: Live }) {
  const s = stats(feed)
  const call = feed.calls[0]
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])

  const wallet = useMemo(() => {
    const pts = feed.curve
    if (pts.length < 2) return ''
    const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts
    const vals = pts.map((p) => p.sol)
    const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 240
    const y = (v: number) => 70 - ((v - lo) / (hi - lo || 1)) * 66
    let line = `M0,${y(pts[0].sol)}`
    for (let i = 1; i < pts.length; i++) line += `H${x(pts[i].ts)}V${y(pts[i].sol)}`
    return line
  }, [feed.curve])

  return (
    <div className="mon">
      <div className="mon-menu mono">
        <BotMark size={13} />
        <b>Grok Bot</b>
        <span>File</span>
        <span>View</span>
        <span>Window</span>
        <span className="mon-menu-r">{BOT_WALLET ? short(BOT_WALLET) : 'his wallet'}</span>
        <span>{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      </div>

      <div className="mon-desk">
        <section className="win win-chart">
          <WinBar title={call ? `pump.fun · $${call.symbol}` : 'pump.fun'} />
          {call && (
            <>
              <div className="wc-head">
                <CoinChip call={call} size={24} />
                <b>{call.name}</b>
                <span className="mono">{mc(call.nowMc)}</span>
                <span className="mono">{call.nowMc !== null && call.entryMc !== null && call.entryMc > 0 ? pct(((call.nowMc - call.entryMc) / call.entryMc) * 100) : '–'}</span>
              </div>
              <span className="mono dim">illustrative chart{feed.mode === 'demo' ? ' · sample trades' : ''}</span>
              {call.entryMc !== null && call.nowMc !== null ? <Candles call={{ ...call, entryMc: call.entryMc, nowMc: call.nowMc }} /> : <p className="dim">Historical chart data unavailable.</p>}
            </>
          )}
        </section>

        <section className="win win-wallet">
          <WinBar title="wallet" />
          <div className="ww-big">
            {s.solNow.toFixed(3)}
            <small className="mono">SOL</small>
          </div>
          <div className="ww-pills mono">
            <span className={s.pnl1h >= 0 ? 'gain' : 'loss'}>1h {pct(s.pnl1h)}</span>
            <span className={s.pnl24h >= 0 ? 'gain' : 'loss'}>24h {pct(s.pnl24h)}</span>
          </div>
          <svg viewBox="0 0 240 72" preserveAspectRatio="none" className="ww-line">
            <path d={wallet} fill="none" stroke="#fff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          </svg>
        </section>

        <section className="win win-log">
          <WinBar title={live.mode === 'demo' ? 'sample activity' : 'agent log'} />
          <div className="wl mono">
            {live.actions.length === 0 && <div className="dim">No activity reported.</div>}
            {live.actions.slice(0, 7).reverse().map((a, i, arr) => (
              <div key={a.ts} className={i === arr.length - 1 ? 'now' : ''}>
                <span className="dim">{new Date(a.ts).toLocaleTimeString([], { hour12: false })}</span> {friendly(a.text)}
              </div>
            ))}
            <div className="wl-cursor">▍</div>
          </div>
        </section>
      </div>

      <div className="mon-dock">
        {['#ffffff', '#1683ff', '#13b8a6', '#ff6a00', '#9b5cff'].map((c, i) => (
          <i key={c} style={{ background: c }} className={i === 0 ? 'on' : ''} />
        ))}
      </div>
      <div className="mon-glass" aria-hidden />
    </div>
  )
}

function WinBar({ title }: { title: string }) {
  return (
    <div className="win-bar">
      <span className="win-dots"><i /><i /><i /></span>
      <span className="mono">{title}</span>
    </div>
  )
}

// Candles that start at his entry and walk to where the coin is now. Seeded by the
// trade so the chart holds still between renders.
function Candles({ call }: { call: Call & { entryMc: number; nowMc: number } }) {
  const bars = useMemo(() => {
    let seed = 0
    for (const ch of call.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const n = 46
    const out: { o: number; c: number; h: number; l: number; v: number }[] = []
    let p = call.entryMc * (0.7 + r() * 0.2)
    for (let i = 0; i < n; i++) {
      const target = i < n * 0.55 ? call.entryMc : call.nowMc
      const o = p
      p = p + (target - p) * 0.14 + (r() - 0.5) * call.entryMc * 0.09
      const c = i === n - 1 ? call.nowMc : p
      out.push({ o, c, h: Math.max(o, c) * (1 + r() * 0.04), l: Math.min(o, c) * (1 - r() * 0.04), v: 0.2 + r() })
      p = c
    }
    return out
  }, [call.id, call.entryMc, call.nowMc])
  const lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h))
  const y = (v: number) => 150 - ((v - lo) / (hi - lo || 1)) * 140
  const w = 440 / bars.length
  const entryY = y(call.entryMc)
  return (
    <svg className="wc-svg" viewBox="0 0 470 190" preserveAspectRatio="none">
      {[30, 70, 110, 150].map((g) => <line key={g} x1="0" x2="440" y1={g} y2={g} stroke="#ffffff0c" />)}
      {bars.map((b, i) => {
        const up = b.c >= b.o
        const col = up ? '#4ade80' : '#f87171'
        const x = i * w + w / 2
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
            <rect x={x - w * 0.32} width={w * 0.64} y={Math.min(y(b.o), y(b.c))} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} fill={col} />
            <rect x={x - w * 0.32} width={w * 0.64} y={188 - b.v * 26} height={b.v * 26} fill={col} opacity="0.25" />
          </g>
        )
      })}
      <line x1="0" x2="440" y1={entryY} y2={entryY} stroke="#fff" strokeDasharray="3 4" opacity="0.5" />
      <text x="444" y={entryY + 3} fontSize="9" fill="#ffffff99" fontFamily="var(--mono)">entry</text>
      <text x="444" y={y(call.nowMc) + 3} fontSize="9" fill="#fff" fontFamily="var(--mono)">{mc(call.nowMc).replace('$', '')}</text>
    </svg>
  )
}

// The exit watcher reports in its own shorthand; the log reads it out in plain words.
const EXITS: Record<string, string> = { 'take-profit': 'taking profit', 'take_profit': 'taking profit', 'stop-loss': 'cutting a loss', 'stop_loss': 'cutting a loss', 'trailing-stop': 'locking in gains', 'trailing_stop': 'locking in gains', 'max-hold': 'closing an old position', 'max_hold': 'closing an old position', liquidate: 'closing out' }
function friendly(text: string) {
  const m = /^exit (\S+) planned within seconds$/.exec(text)
  return m ? `${EXITS[m[1]] ?? 'selling'}…` : text
}
