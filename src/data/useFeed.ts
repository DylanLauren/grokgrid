import { useEffect, useRef, useState } from 'react'
import { cachedCoins, realCoins, coinUpdatedAt } from './realCoins'
import { demoFeed, makeCall } from './demo'
import type { Call, Feed } from './types'

const POLL_MS = 10_000
const DEMO_TICK_MS = 22_000

// Polls the site's own feed. If the worker has never posted, the API answers
// mode "demo" and the client plays the labelled demo story instead.
export function useFeed(): Feed {
  const [feed, setFeed] = useState<Feed>(() => demoFeed())
  const mode = useRef<Feed['mode']>('demo')

  useEffect(() => {
    let alive = true
    let ctrl: AbortController | null = null
    const pull = async () => {
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const res = await fetch('/api/feed', { signal: ctrl.signal })
        if (!res.ok) return
        const live = (await res.json()) as Feed
        if (alive && live.mode === 'live') {
          mode.current = 'live'
          setFeed(live)
        }
      } catch {
        /* offline or local dev without functions: stay on demo */
      }
    }
    const coins = async () => {
      const tokens = await realCoins()
      if (!alive || mode.current !== 'demo') return
      setFeed((f) => ({ ...f, marketUpdatedAt: coinUpdatedAt(), calls: f.calls.map((call) => {
        const coin = tokens.find((c) => c.mint === call.mint)
        return coin ? { ...call, symbol: coin.symbol, name: coin.name, image: coin.image, nowMc: coin.mcUsd } : call
      }) }))
    }
    coins()
    const coinPoll = setInterval(coins, 60_000)
    pull()
    const poll = setInterval(pull, POLL_MS)

    let n = 0
    const demo = setInterval(() => {
      if (mode.current !== 'demo') return
      setFeed((f) => {
        const r = Math.random
        const call = makeCall(r, Date.now(), n++, f.solUsd, cachedCoins())
        const last = f.curve[f.curve.length - 1]
        const sol = Math.max(0.2, last.sol + (call.pnlUsd ?? 0) / f.solUsd)
        return {
          ...f,
          calls: [call, ...f.calls].slice(0, 80),
          curve: [...f.curve.slice(-200), { ts: call.ts, sol }],
        }
      })
    }, DEMO_TICK_MS)

    return () => {
      alive = false
      ctrl?.abort()
      clearInterval(coinPoll)
      clearInterval(poll)
      clearInterval(demo)
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
