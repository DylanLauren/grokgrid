import { useEffect, useState } from 'react'
import type { AgentsFeed } from './types'

const POLL_MS = 10_000

const EMPTY: AgentsFeed = { mode: 'loading', updatedAt: 0, solUsd: 0, agents: [] }

// Every agent on the grid with its coin's market data, refreshed every 10s.
export function useAgents(active: boolean): AgentsFeed {
  const [feed, setFeed] = useState<AgentsFeed>(EMPTY)

  useEffect(() => {
    if (!active) return
    let alive = true
    let ctrl: AbortController | null = null
    const pull = async () => {
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const res = await fetch('/api/agents', { signal: ctrl.signal })
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as AgentsFeed
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
  }, [active])

  return feed
}
