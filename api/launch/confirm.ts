// Polled once the launch is sent: reads the coin back off chain and, only when the 80/20
// split is locked to the right wallets, puts the bot on the grid for Grok Bot to run.
import { hasStore, isAddress } from '../_lib.js'
import { limited, noStore, readJson } from '../_launch.js'
import { finishLaunch } from '../_finish.js'

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'confirm', 120)
  if (slow) return slow
  const b = await readJson<{ mint?: unknown }>(req, 1_000)
  if (!b || !isAddress(b.mint)) return noStore({ error: 'bad request' }, 400)
  const r = await finishLaunch(b.mint)
  return noStore(r.body, r.status)
}
