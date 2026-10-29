import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentsFeed, Feed } from '../data/types'
import { useAgents } from '../data/useAgents'
import { CoinChip } from './CoinChip'

// Every real trade the bots make pops up over his phone screen, the way pump.fun's own
// trade alerts do: his calls from the feed, and each grid bot's latest trade while you watch.
// Only real, on-chain trades: sample data never shows here.
const SHOW_MS = 10 * 60_000 // a trade stays in the stack for ten minutes
const MAX = 3

interface Alert { key: string; who: string; side: 'buy' | 'sell'; symbol: string; image?: string; hue?: string; sol: number; ts: number }

export function PhoneTrades({ feed, watching }: { feed: Feed; watching: boolean }) {
  const grid = useAgents(watching)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const alerts = useMemo(() => collect(feed, grid), [feed, grid])
  const fresh = alerts.filter((a) => now - a.ts < SHOW_MS).slice(0, MAX)
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
              <b>{a.who}</b> {a.side === 'buy' ? 'bought' : 'sold'} <b>{a.sol.toFixed(3)} SOL</b> of <b>${a.symbol}</b>
            </span>
            <span className="pt-side mono">{a.side}</span>
          </div>
        )
      })}
    </div>
  )
}

function collect(feed: Feed, grid: AgentsFeed): Alert[] {
  const out: Alert[] = []
  if (feed.mode === 'live') {
    for (const c of feed.calls) {
      if (c.sample || !c.sig) continue
      out.push({ key: c.sig, who: 'Grok Bot', side: c.side, symbol: c.symbol, image: c.image, hue: c.hue, sol: c.spentSol, ts: c.ts })
    }
  }
  if (grid.mode === 'live') {
    for (const g of grid.agents) {
      const t = g.last
      if (g.house || !t?.sig || g.id.startsWith('demo')) continue
      out.push({ key: t.sig, who: g.name, side: t.side, symbol: t.symbol, image: t.image, hue: t.hue, sol: t.spentSol, ts: t.ts })
    }
  }
  return out.sort((a, b) => b.ts - a.ts)
}
