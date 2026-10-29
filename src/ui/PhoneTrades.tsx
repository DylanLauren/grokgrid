import { useEffect, useRef, useState } from 'react'
import type { Feed } from '../data/types'
import { sol } from '../lib/format'
import { CoinChip } from './CoinChip'

// Each real trade the house bot makes pops up over his phone screen for a few seconds, the way
// pump.fun's own trade alerts do, then fades. Only real, on-chain trades: sample data never
// shows here. Trades already in the feed when the page opened are history, not alerts.
const SHOW_MS = 6000
const MAX = 2

interface Alert { key: string; side: 'buy' | 'sell'; symbol: string; image?: string; hue?: string; sol: number }

export function PhoneTrades({ feed }: { feed: Feed }) {
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef<Set<string> | null>(null)
  const shown = useRef<{ a: Alert; at: number }[]>([])

  const live = feed.mode === 'live' ? collect(feed) : null
  if (live) {
    if (!seen.current) seen.current = new Set(live.map((a) => a.key))
    for (const a of live) {
      if (seen.current.has(a.key)) continue
      seen.current.add(a.key)
      shown.current = [{ a, at: Date.now() }, ...shown.current]
    }
  }
  const active = shown.current.filter((s) => now - s.at < SHOW_MS).slice(0, MAX)

  useEffect(() => {
    if (!active.length) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [active.length])
  // a new alert has to start the clock even while none are showing
  useEffect(() => { setNow(Date.now()) }, [feed])

  if (!active.length) return null
  return (
    <div className="pt" aria-live="polite">
      {active.map(({ a, at }) => (
        <div key={a.key} className={`pt-row ${a.side} ${now - at > SHOW_MS - 700 ? 'out' : ''}`}>
          <CoinChip call={{ symbol: a.symbol, image: a.image, hue: a.hue ?? '#5a5a66' }} size={16} />
          <span className="pt-text">
            {a.side === 'buy' ? 'bought' : 'sold'} <b>${a.symbol}</b>
          </span>
          <span className="pt-sol mono">{sol(a.sol)} SOL</span>
        </div>
      ))}
    </div>
  )
}

function collect(feed: Feed): Alert[] {
  const out: Alert[] = []
  for (const c of feed.calls) {
    if (c.sample || !c.sig) continue
    out.push({ key: c.sig, side: c.side, symbol: c.symbol, image: c.image, hue: c.hue, sol: c.spentSol })
  }
  return out
}
