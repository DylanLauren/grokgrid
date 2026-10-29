import { useEffect, useState } from 'react'

export type WorkerName = 'trading' | 'strategy' | 'agent-runner' | 'buyback' | 'phone'
export interface WorkerBeat { online: boolean; mode: string | null; agents: number | null; seenAt: number | null }
export type Workers = Record<WorkerName, WorkerBeat>

// Live heartbeats from the workers on his machine, via /api/status.
export function useWorkers(active: boolean): Workers | null {
  const [workers, setWorkers] = useState<Workers | null>(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    const load = () =>
      fetch('/api/status')
        .then((r) => (r.ok ? (r.json() as Promise<{ workers?: Workers }>) : null))
        .then((s) => alive && s?.workers && setWorkers(s.workers))
        .catch(() => {})
    load()
    const id = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [active])
  return workers
}
