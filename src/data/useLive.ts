import { useEffect, useState } from 'react'
import type { Live } from './types'
import { LIVE_FAST_MS, LIVE_ROOM_MS, startLivePolling } from './livePolling'

export const FRESH_MS = 12_000 // a frame older than this means his screen stream is off

// Polls /api/live while the room is open, fast while his phone is being watched.
export function useLive(active: boolean, fast: boolean): Live {
  const [live, setLive] = useState<Live>({ mode: 'idle', actions: [], screenTs: 0 })

  useEffect(() => {
    if (!active) return
    return startLivePolling(async (signal) => {
      const res = await fetch('/api/live', { signal })
      if (!res.ok) return
      const j = (await res.json()) as Omit<Live, 'mode'>
      if (signal.aborted) return
      const actions = j.actions ?? []
      setLive({ mode: actions.length || j.screenTs ? 'live' : 'idle', actions, screenTs: j.screenTs ?? 0 })
    }, fast ? LIVE_FAST_MS : LIVE_ROOM_MS)
  }, [active, fast])

  return live
}
