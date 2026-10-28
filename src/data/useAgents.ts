import { useEffect, useRef, useState } from 'react'
import { demoAgents, driftAgents } from './demoAgents'
import type { AgentsFeed } from './types'

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
    pull()
    const poll = setInterval(pull, POLL_MS)
    const demo = setInterval(() => mode.current === 'demo' && setFeed((f) => driftAgents(f)), DEMO_TICK_MS)
    return () => {
      alive = false
      ctrl?.abort()
      clearInterval(poll)
      clearInterval(demo)
    }
  }, [active])

  return feed
}
