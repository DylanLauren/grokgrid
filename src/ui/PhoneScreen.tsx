import { useEffect, useMemo, useState } from 'react'
import type { Call, Feed } from '../data/types'
import { mc, signedUsd, tokens, usd } from '../lib/format'
import { CoinChip } from './CoinChip'
import './phone.css'

// What his phone shows when the live screen stream is offline: the pump.fun app,
// redrawn from his real trades. Same layout at any size; the parent scales it.
export function PhoneScreen({ feed }: { feed: Feed }) {
  const call = feed.calls[0]
  const [flash, setFlash] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    if (!call) return
    setFlash(call.id)
    const t = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(t)
  }, [call?.id])

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])

  if (!call) return <div className="ph" />
  const change = ((call.nowMc - call.entryMc) / call.entryMc) * 100

  return (
    <div className="ph">
      <div className="ph-status mono">
        <span>{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="ph-island" />
        <span>5G</span>
      </div>
      <div className="ph-nav">
        <span className="ph-back">‹</span>
        <span className="ph-brand">pump.fun</span>
        {feed.mode === 'demo' ? <span className="ph-demo mono">demo</span> : <span />}
      </div>

      <div className="ph-coin">
        <CoinChip call={call} size={44} />
        <div>
          <div className="ph-sym">{call.symbol}</div>
          <div className="ph-name">{call.name}</div>
        </div>
      </div>
      <div className="ph-mc">
        <span className="ph-mc-v">{mc(call.nowMc)}</span>
        <span className={change >= 0 ? 'gain' : 'loss'}>{change >= 0 ? '+' : ''}{change.toFixed(1)}%</span>
      </div>
      <MiniChart call={call} />

      <div className="ph-pos">
        <div><span>Size</span><b>{tokens(call.sizeTokens)}</b></div>
        <div><span>Position</span><b>{usd(call.positionUsd)}</b></div>
        <div><span>Profit</span><b className={call.pnlUsd >= 0 ? 'gain' : 'loss'}>{signedUsd(call.pnlUsd)}</b></div>
      </div>

      <div className="ph-trade">
        <button className={`ph-buy ${flash && call.side === 'buy' ? 'on' : ''}`}>Buy</button>
        <button className={`ph-sell ${flash && call.side === 'sell' ? 'on' : ''}`}>Sell</button>
      </div>

      <div className="ph-list">
        {feed.calls.slice(1, 5).map((c) => (
          <div className="ph-row" key={c.id}>
            <CoinChip call={c} size={22} />
            <span className="ph-row-s">{c.symbol}</span>
            <span className={`mono ${c.side === 'buy' ? 'dim' : c.pnlUsd >= 0 ? 'gain' : 'loss'}`}>
              {c.side === 'buy' ? `bought ${c.spentSol} SOL` : signedUsd(c.pnlUsd)}
            </span>
          </div>
        ))}
      </div>

      {flash && (
        <div className="ph-toast" key={flash}>
          {call.side === 'buy' ? `Bought ${call.spentSol} SOL of ${call.symbol}` : `Sold ${call.symbol} ${signedUsd(call.pnlUsd)}`}
        </div>
      )}
    </div>
  )
}

function MiniChart({ call }: { call: Call }) {
  const d = useMemo(() => {
    let seed = 0
    for (const ch of call.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const n = 48
    const pts: number[] = []
    let v = call.entryMc * 0.8
    for (let i = 0; i < n; i++) {
      const target = i < n / 2 ? call.entryMc : call.nowMc
      v += (target - v) * 0.12 + (r() - 0.5) * call.entryMc * 0.05
      pts.push(v)
    }
    pts[n - 1] = call.nowMc
    const lo = Math.min(...pts), hi = Math.max(...pts)
    return pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (n - 1)) * 280},${86 - ((p - lo) / (hi - lo || 1)) * 80}`).join('')
  }, [call.id, call.entryMc, call.nowMc])
  const up = call.nowMc >= call.entryMc
  return (
    <svg className="ph-chart" viewBox="0 0 280 90" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={up ? 'var(--gain)' : 'var(--loss)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
