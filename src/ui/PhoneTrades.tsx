import { useEffect, useRef, useState } from 'react'
import type { Feed, Live } from '../data/types'
import { mc, sol } from '../lib/format'
import { CoinChip } from './CoinChip'

// Each real trade the house bot makes pops up over his phone screen for a few seconds, the way
// pump.fun's own trade alerts do, then fades. Only real, on-chain trades: sample data never
// shows here. Trades already in the feed when the page opened are history, not alerts. His real
// pump.fun callouts pop up the same way the moment one posts.
const SHOW_MS = 6000
const MAX = 2

interface Alert {
  key: string; side: 'buy' | 'sell' | 'call'; symbol: string; image?: string; hue?: string; sol: number
  atMc?: string // market cap at this trade
  fromMc?: string // on a sell, the market cap he bought at
  pnl?: number // on a sell, realised SOL
  pct?: number
}
const fmtMc = (n?: number, approx?: boolean) => (n ? `${approx ? '≈' : ''}${mc(n)}` : undefined)

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
        <div key={a.key} className={`pt-row ${a.side} ${a.atMc || a.pnl !== undefined ? 'two' : ''} ${now - at > SHOW_MS - 700 ? 'out' : ''}`}>
          <CoinChip call={{ symbol: a.symbol, image: a.image, hue: a.hue ?? '#5a5a66' }} size={a.atMc || a.pnl !== undefined ? 20 : 16} />
          <span className="pt-main">
            <span className="pt-line">
              <span className="pt-text">
                {a.side === 'call' ? 'called out' : a.side === 'buy' ? 'bought' : 'sold'} <b>${a.symbol}</b>
              </span>
              {a.side === 'sell' && a.pnl !== undefined ? (
                <span className={`pt-sol mono ${a.pnl >= 0 ? 'up' : 'down'}`}>{a.pct !== undefined ? `${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(1)}%` : `${a.pnl >= 0 ? '+' : ''}${a.pnl.toFixed(5)} SOL`}</span>
              ) : (
                <span className="pt-sol mono">{a.side === 'call' ? 'pump.fun' : `${sol(a.sol)} SOL`}</span>
              )}
            </span>
            {(a.atMc || a.pnl !== undefined) && (
              <span className="pt-sub mono">
                {a.atMc && <span>{a.side === 'sell' && a.fromMc ? `${a.fromMc} → ${a.atMc}` : a.atMc} mc</span>}
                {a.side === 'sell' && a.pnl !== undefined && <span className={a.pnl >= 0 ? 'up' : 'down'}>{a.pnl >= 0 ? '+' : ''}{a.pnl.toFixed(5)} SOL</span>}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function collect(feed: Feed): Alert[] {
  const out: Alert[] = []
  const firstBuy = new Map<string, (typeof feed.calls)[number]>() // the buy that opened each holding
  for (const c of [...feed.calls].sort((a, b) => a.ts - b.ts)) {
    if (c.sample || !c.sig) continue
    const atMc = fmtMc(c.tradeMc, c.tradeMcApprox)
    if (c.side === 'buy') {
      if (!firstBuy.has(c.mint)) firstBuy.set(c.mint, c)
      out.push({ key: c.sig, side: 'buy', symbol: c.symbol, image: c.image, hue: c.hue, sol: c.spentSol, atMc })
      continue
    }
    const open = firstBuy.get(c.mint)
    firstBuy.delete(c.mint)
    const pnl = typeof c.pnlSol === 'number' ? c.pnlSol : undefined
    const cost = pnl !== undefined ? c.spentSol - pnl : 0
    out.push({ key: c.sig, side: 'sell', symbol: c.symbol, image: c.image, hue: c.hue, sol: c.spentSol, atMc, fromMc: fmtMc(open?.tradeMc, open?.tradeMcApprox), pnl, pct: pnl !== undefined && cost > 0 ? (pnl / cost) * 100 : undefined })
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
