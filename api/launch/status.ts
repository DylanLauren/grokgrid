import { hasStore, isAddress, redis } from '../_lib.js'
import { launchStatus, limited, noStore } from '../_launch.js'
import { launchOwnerState } from '../_launch-owner.js'
import { OPEN, finishLaunch } from '../_finish.js'

// Whether a bot can launch right now, and how many trading wallets are ready. The grid page
// polls this, so it also finishes a couple of sent launches whose tab was closed early.
export async function GET(req?: Request) {
  const launcher=req?new URL(req.url).searchParams.get('launcher'):null
  if(launcher!==null&&!isAddress(launcher))return noStore({error:'Invalid launcher wallet.'},400)
  if (!hasStore()) return noStore({ open: false, reason: 'The launchpad is offline for a moment, try again soon.', free: 0, walletModel: 'launcher', oneAgentPerWallet: true, ...(launcher?{ownerState:{state:'review'}}:{}) })
  if(launcher&&req){const slow=await limited(req,'owner-status',30,true);if(slow)return slow}
  const [open] = await redis(['SRANDMEMBER', OPEN, 2]).catch(() => [[]])
  await Promise.all(((open as string[]) ?? []).filter(isAddress).map((m) => finishLaunch(m).catch(() => null)))
  const ownerState=launcher?await launchOwnerState(launcher).catch(()=>({state:'review' as const})):undefined
  return noStore({ ...await launchStatus(), ...(ownerState?{ownerState}:{}) })
}
