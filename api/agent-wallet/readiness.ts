import { privyReadinessConfig, privyReadinessProvider, sdkReads } from '../_privy-provider.js'
import { verifyPrivyWalletReadiness } from '../_privy-readiness.js'
import { limited, readJson } from '../_launch.js'

const headers = { 'Cache-Control': 'no-store' }

// Read-only: proves a wallet grant. It never signs, funds or enables a worker.
export async function POST(req: Request) {
  const config = privyReadinessConfig()
  if (!config) return Response.json({ canAuthorize: false, walletAuthorizationReady: false, executionEnabled: false, reason: 'configuration-missing' }, { headers })
  const auth = req.headers.get('authorization') || ''
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const slow = await limited(req, 'readiness', 10)
  if (slow) return slow
  const body = await readJson<Record<string, unknown>>(req, 4096)
  if (!body || typeof body !== 'object') {
    return Response.json({ canAuthorize: false, walletAuthorizationReady: false, executionEnabled: false, reason: 'invalid-request' }, { status: 400, headers })
  }
  const result = await verifyPrivyWalletReadiness({ accessToken, walletId: body?.walletId, address: body?.address },
    config, privyReadinessProvider(sdkReads()))
  return Response.json(result, { headers })
}
