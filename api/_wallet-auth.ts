import { privyReadinessConfig, privyReadinessProvider, sdkReads } from './_privy-provider.js'
import { verifyPrivyWalletReadiness } from './_privy-readiness.js'

// The Privy wallet id the request's bearer token proves it owns, with GrokGrid's scoped signer
// on it, for this launcher address. Null when any of that doesn't hold.
export async function verifiedWalletId(req: Request, walletId: unknown, launcher: string): Promise<string | null> {
  const config = privyReadinessConfig()
  if (!config) return null
  const auth = req.headers.get('authorization') || ''
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const r = await verifyPrivyWalletReadiness({ accessToken, walletId, address: launcher }, config, privyReadinessProvider(sdkReads()))
  return r.canAuthorize && r.walletAuthorizationReady && r.address === launcher && r.walletId === walletId ? r.walletId : null
}
