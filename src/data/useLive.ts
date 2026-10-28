import { useEffect, useRef, useState } from 'react'
import type { Call, Feed, Live } from './types'

const FAST_MS = 2_500 // while someone watches his phone
const SLOW_MS = 15_000 // the monitor's log, the rest of the time
export const FRESH_MS = 12_000 // a frame older than this means his screen stream is off

// The steps he goes through for one trade, used to narrate the demo.
const STEPS = (c: Call) =>
  c.side === 'buy'
    ? ['scrolling the trader list on X', `${c.symbol} came up twice in 10 minutes`, `opening ${c.symbol} on pump.fun`, 'checking holders and the dev wallet', `buying ${c.spentSol} SOL of ${c.symbol}`, 'confirmed on chain', 'posting the call']
    : [`watching ${c.symbol}`, `${c.symbol} at ${(c.nowMc === null ? 'unknown' : (c.nowMc / 1e3).toFixed(0))}K mc`, `selling ${c.symbol}`, 'confirmed on chain', 'posting the call']

// Polls /api/live while the room is open, fast while his phone is being watched. Until he posts real actions,
// it narrates the demo trades step by step.
export function useLive(active: boolean, fast: boolean, feed: Feed): Live {
  const [live, setLive] = useState<Live>({ mode: 'demo', actions: [], screenTs: 0 })
  const real = useRef(false)

  useEffect(() => {
    if (!active) return
    let ctrl: AbortController | null = null
    const pull = async () => {
      ctrl?.abort()
      ctrl = new AbortController()
      try {
        const res = await fetch('/api/live', { signal: ctrl.signal })
        if (!res.ok) return
        const j = (await res.json()) as Omit<Live, 'mode'>
        if (j.actions?.length || j.screenTs) {
          real.current = true
          setLive({ mode: 'live', actions: j.actions ?? [], screenTs: j.screenTs ?? 0 })
        }
      } catch {
        /* local dev without functions */
      }
    }
    pull()
    const t = setInterval(pull, fast ? FAST_MS : SLOW_MS)
    return () => {
      ctrl?.abort()
      clearInterval(t)
    }
  }, [active, fast])

  // demo narration: replay the steps of his latest trade, one every ~2.4s
  const last = feed.calls[0]
  useEffect(() => {
    if (!active || real.current || feed.mode !== 'demo' || !last) return
    const steps = STEPS(last)
    let i = 0
    const push = () => {
      const text = steps[i % steps.length]
      i++
      setLive((l) => (real.current ? l : { mode: 'demo', screenTs: 0, actions: [{ ts: Date.now(), text }, ...l.actions].slice(0, 12) }))
    }
    push()
    const t = setInterval(push, 2400)
    return () => clearInterval(t)
  }, [active, last, feed.mode])

  return live
}
