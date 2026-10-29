export const LIVE_FAST_MS = 2_500
export const LIVE_ROOM_MS = 5_000

type Clock = {
  now: () => number
  set: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}
const clock: Clock = { now: Date.now, set: (fn, ms) => setTimeout(fn, ms), clear: (timer) => clearTimeout(timer) }

// One request at a time. Slow requests get a bounded timeout rather than being
// repeatedly aborted by the next interval; changing view starts a new loop.
export function startLivePolling(pull: (signal: AbortSignal) => Promise<void>, interval: number, timers: Clock = clock) {
  let stopped = false
  let next: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  const run = async () => {
    if (stopped) return
    const started = timers.now()
    controller = new AbortController()
    const current = controller
    timeout = timers.set(() => current.abort(), 8_000)
    try { await pull(current.signal) } catch { /* Keep the last real timestamp; it will expire normally. */ }
    finally {
      if (timeout !== undefined) timers.clear(timeout)
      controller = undefined
      if (!stopped) next = timers.set(() => { void run() }, Math.max(0, interval - (timers.now() - started)))
    }
  }
  void run()
  return () => {
    stopped = true
    if (next !== undefined) timers.clear(next)
    if (timeout !== undefined) timers.clear(timeout)
    controller?.abort()
  }
}
