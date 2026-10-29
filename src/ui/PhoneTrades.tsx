import { useEffect, useRef, useState } from 'react'
import type { Feed, Live } from '../data/types'
import { sol } from '../lib/format'
import { CoinChip } from './CoinChip'

// Each real trade the house bot makes pops up over his phone screen for a few seconds, the way
// pump.fun's own trade alerts do, then fades. Only real, on-chain trades: sample data never
// shows here. Trades already in the feed when the page opened are history, not alerts. His real
// pump.fun callouts pop up the same way the moment one posts.
const SHOW_MS = 6000
const MAX = 2

interface Alert { key: string; side: 'buy' | 'sell' | 'call'; symbol: string; image?: string; hue?: string; sol: number }

export function PhoneTrades({ feed, live }: { feed: Feed; live: Live }) {
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef<Set<string> | null>(null)
  const shown = useRef<{ a: Alert; at: number }[]>([])

  const fresh = feed.mode === 'live' && live.mode === 'live' ? [...collect(feed), ...callouts(feed, live)] : null
  if (fresh) {
    if (!seen.current) seen.current = new Set(fresh.map((a) => a.key))
    for (const a of fresh) {
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
  useEffect(() => { setNow(Date.now()) }, [feed, live])

  if (!active.length) return null
  return (
    <div className="pt" aria-live="polite">
      {active.map(({ a, at }) => (
        <div key={a.key} className={`pt-row ${a.side} ${now - at > SHOW_MS - 700 ? 'out' : ''}`}>
          <CoinChip call={{ symbol: a.symbol, image: a.image, hue: a.hue ?? '#5a5a66' }} size={16} />
          <span className="pt-text">
            {a.side === 'call' ? 'called out' : a.side === 'buy' ? 'bought' : 'sold'} <b>${a.symbol}</b>
          </span>
          <span className="pt-sol mono">{a.side === 'call' ? 'pump.fun' : `${sol(a.sol)} SOL`}</span>
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

// The callout worker announces each posted callout as "called $SYM on pump.fun".
function callouts(feed: Feed, live: Live): Alert[] {
  const out: Alert[] = []
  for (const x of live.actions) {
    const m = /^called \$([\w]{1,12}) on pump\.fun/.exec(x.text)
    if (!m) continue
    const coin = feed.calls.find((c) => c.symbol === m[1])
    out.push({ key: `call-${x.ts}`, side: 'call', symbol: m[1], image: coin?.image, hue: coin?.hue, sol: 0 })
  }
  return out
}
