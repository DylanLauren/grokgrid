import { hasStore, isAddress, redis } from '../_lib.js'
import { launchStatus, noStore } from '../_launch.js'
import { OPEN, finishLaunch } from '../_finish.js'

// Whether a bot can launch right now, and how many trading wallets are ready. The grid page
// polls this, so it also finishes a couple of sent launches whose tab was closed early.
export async function GET() {
  if (!hasStore()) return noStore({ open: false, reason: 'The launchpad is offline for a moment, try again soon.', free: 0 })
  const [open] = await redis(['SRANDMEMBER', OPEN, 2]).catch(() => [[]])
  await Promise.all(((open as string[]) ?? []).filter(isAddress).map((m) => finishLaunch(m).catch(() => null)))
  return noStore(await launchStatus())
}
