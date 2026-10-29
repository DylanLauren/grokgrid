import { useEffect, useState } from 'react'
import type { Call, Feed } from './types'

const POLL_MS = 10_000

const EMPTY: Feed = { mode: 'loading', wallet: null, solUsd: 0, calls: [], curve: [], burnedMain: 0, feesSol: 0 }

// Polls the site's own feed: his calls and wallet curve, read back from the chain.
export function useFeed(): Feed {
  const [feed, setFeed] = useState<Feed>(EMPTY)

  useEffect(() => {
    let alive = true
    let ctrl: AbortController | null = null
    const pull = async () => {
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const res = await fetch('/api/feed', { signal: ctrl.signal })
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as Feed
        if (alive) setFeed({ ...EMPTY, ...next })
      } catch (e) {
        if (alive && (e as Error).name !== 'AbortError') setFeed((f) => (f.mode === 'loading' ? { ...f, mode: 'error' } : f))
      }
    }
    pull()
    const poll = setInterval(pull, POLL_MS)
    return () => {
      alive = false
      ctrl?.abort()
      clearInterval(poll)
    }
  }, [])

  return feed
}
export function stats(feed: Feed) {
  const now = Date.now()
  const solNow = feed.curve.at(-1)?.sol ?? 0
  const at = (ms: number) => feed.curve.find((p) => p.ts >= now - ms)?.sol ?? feed.curve[0]?.sol ?? 0
  const sells = feed.calls.filter((c): c is Call & { pnlUsd: number } => c.side === 'sell' && c.pnlUsd !== null && Number.isFinite(c.pnlUsd))
  const wins = sells.filter((c) => c.pnlUsd > 0)
  const best = sells.reduce((a, c) => (c.pnlUsd > (a?.pnlUsd ?? -Infinity) ? c : a), sells[0])
  const worst = sells.reduce((a, c) => (c.pnlUsd < (a?.pnlUsd ?? Infinity) ? c : a), sells[0])
  const pct = (from: number) => (from ? ((solNow - from) / from) * 100 : 0)
  return {
    solNow,
    usdNow: solNow * feed.solUsd,
    pnl1h: pct(at(3.6e6)),
    pnl24h: pct(at(8.64e7)),
    pnlAll: pct(feed.curve[0]?.sol ?? 0),
    trades: feed.calls.length,
    winRate: sells.length ? (wins.length / sells.length) * 100 : null,
    best,
    worst,
  }
}
