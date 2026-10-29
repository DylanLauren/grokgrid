import { beats, fresh, WORKERS } from './_heartbeat.js'
import { json } from './_lib.js'

// Public: which of his workers are up and in what mode. No wallets, no keys, no config.
export async function GET() {
  const all = await beats().catch(() => ({}) as Awaited<ReturnType<typeof beats>>)
  const now = Date.now()
  const workers = Object.fromEntries(
    WORKERS.map((w) => {
      const b = all[w]
      return [w, b ? { online: fresh(b, now), mode: b.mode, agents: b.agents, seenAt: b.ts } : { online: false, mode: null, agents: null, seenAt: null }]
    }),
  )
  return json({ workers, checkedAt: now }, 200, 5)
}
