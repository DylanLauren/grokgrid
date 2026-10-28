import { useEffect, useRef, useState } from 'react'
import { demoAgents, driftAgents, withRealCoins } from './demoAgents'
import type { AgentsFeed, RealCoin } from './types'

const POLL_MS = 10_000
const DEMO_TICK_MS = 4_000

// Every agent on the grid with its coin's market data, refreshed every 10s.
// Falls back to the labelled demo grid until the first agent launches.
export function useAgents(active: boolean): AgentsFeed {
  const [feed, setFeed] = useState<AgentsFeed>(() => demoAgents())
  const mode = useRef<AgentsFeed['mode']>('demo')

  useEffect(() => {
    if (!active) return
    let alive = true
    let ctrl: AbortController | null = null
    const pull = async () => {
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const res = await fetch('/api/agents', { signal: ctrl.signal })
        if (!res.ok) return
        const live = (await res.json()) as AgentsFeed
        if (alive && live.mode === 'live') {
          mode.current = 'live'
          setFeed(live)
        }
      } catch {
        /* local dev without functions: stay on demo */
      }
    }
    // until real bots launch, the sample bots carry real coins with live numbers
    const coins = async () => {
      if (mode.current !== 'demo') return
      try {
        const res = await fetch('/api/coins')
        if (!res.ok) return
        const { coins } = (await res.json()) as { coins: RealCoin[] }
        if (alive && mode.current === 'demo') setFeed((f) => withRealCoins(f, coins))
      } catch {
        /* local dev without functions: keep the sample coins */
      }
    }
    pull()
    coins()
    const poll = setInterval(pull, POLL_MS)
    const coinPoll = setInterval(coins, 60_000)
    const demo = setInterval(() => mode.current === 'demo' && setFeed((f) => driftAgents(f)), DEMO_TICK_MS)
    return () => {
      alive = false
      ctrl?.abort()
      clearInterval(poll)
      clearInterval(coinPoll)
      clearInterval(demo)
    }
  }, [active])

  return feed
}
