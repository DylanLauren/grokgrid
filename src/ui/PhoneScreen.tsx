import { useEffect, useMemo, useState } from 'react'
import type { Call, Feed, Live } from '../data/types'
import { FRESH_MS } from '../data/useLive'
import { mc, signedUsd, tokens, usd } from '../lib/format'
import { CoinChip } from './CoinChip'
import './phone.css'

// His phone. When Grok Bot streams his screen, this is the real frame from his phone.
// When it does not, the pump.fun app is redrawn from his real trades and the island
// at the top narrates what he is doing. Same layout at any size; the parent scales it.
export function PhoneScreen({ feed, live }: { feed: Feed; live: Live }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (live.screenTs && now - live.screenTs < FRESH_MS) return <Stream ts={live.screenTs} />
  return <App feed={feed} live={live} />
}

// Real frames from his phone. The next frame loads behind the current one, then swaps in,
// so the screen never flashes blank.
function Stream({ ts }: { ts: number }) {
  const [shown, setShown] = useState(ts)
  return (
    <div className="ph ph-stream">
      <img src={`/api/screen?t=${shown}`} alt="his phone screen, live" />
      {ts !== shown && <img className="ph-next" src={`/api/screen?t=${ts}`} alt="" onLoad={() => setShown(ts)} />}
      <span className="ph-live mono"><i />live</span>
    </div>
  )
}

function App({ feed, live }: { feed: Feed; live: Live }) {
  const call = feed.calls[0]
  const doing = live.actions[0]
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
        <span className="ph-bars"><i /><i /><i /><i /><b /></span>
      </div>
      <span className="ph-island" />
      <div className="ph-agent">
        <img src="/brands/grokbot.svg" alt="" width={14} height={14} />
        {doing ? (
          <span key={doing.ts} className="ph-doing">{doing.text}</span>
        ) : (
          <span className="ph-doing dim">waiting for his next move</span>
        )}
        <i />
      </div>
      <div className="ph-nav">
        <span className="ph-back">‹</span>
        <span className="ph-brand"><img src="/brands/pumpfun.svg" alt="" width={16} height={16} />pump.fun</span>
        <span />
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
        <button className={`ph-buy ${flash && call.side === 'buy' ? 'on' : ''}`}>Buy{flash && call.side === 'buy' && <span className="ph-tap" />}</button>
        <button className={`ph-sell ${flash && call.side === 'sell' ? 'on' : ''}`}>Sell{flash && call.side === 'sell' && <span className="ph-tap" />}</button>
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
