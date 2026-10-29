import { useEffect, useMemo, useRef, useState } from 'react'
import type { Feed } from '../data/types'
import { ago, sol } from '../lib/format'
import { CoinChip } from './CoinChip'

// Every real trade the house bot makes pops up over his phone screen, the way pump.fun's own
// trade alerts do. Only real, on-chain trades: sample data never shows here. His last few
// trades always stay up, and a feed hiccup keeps the last good ones rather than blanking.
const MAX = 3

interface Alert { key: string; who: string; side: 'buy' | 'sell'; symbol: string; image?: string; hue?: string; sol: number; ts: number }

export function PhoneTrades({ feed }: { feed: Feed }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const last = useRef<Alert[]>([])
  const alerts = useMemo(() => {
    if (feed.mode === 'live') last.current = collect(feed)
    return last.current
  }, [feed])
  const fresh = alerts.slice(0, MAX)
  // trades already on screen when the page opened don't animate in; new ones do
  const seen = useRef<Set<string> | null>(null)
  if (!seen.current) seen.current = new Set(fresh.map((a) => a.key))
  if (!fresh.length) return null
  return (
    <div className="pt" aria-label="latest trades">
      {fresh.map((a) => {
        const isNew = !seen.current!.has(a.key)
        return (
          <div key={a.key} className={`pt-row ${a.side} ${isNew ? 'new' : ''}`}>
            <CoinChip call={{ symbol: a.symbol, image: a.image, hue: a.hue ?? '#5a5a66' }} size={22} />
            <span className="pt-text">
              <b>{a.who}</b> {a.side === 'buy' ? 'bought' : 'sold'} <b>{sol(a.sol)} SOL</b> of <b>${a.symbol}</b>
            </span>
            <span className="pt-ago mono">{ago(a.ts, now)}</span>
            <span className="pt-side mono">{a.side}</span>
          </div>
        )
      })}
    </div>
  )
}

function collect(feed: Feed): Alert[] {
  const out: Alert[] = []
  for (const c of feed.calls) {
    if (c.sample || !c.sig) continue
    out.push({ key: c.sig, who: 'House Trader', side: c.side, symbol: c.symbol, image: c.image, hue: c.hue, sol: c.spentSol, ts: c.ts })
  }
  return out.sort((a, b) => b.ts - a.ts)
}
