import type { WalletLike } from './wallet'

// Setup is available independently; this release never opens financial execution.
export const PUBLIC_AGENT_LAUNCHES_ENABLED = false
export interface AgentWalletSession {
  address: string
  walletId: string
  wallet: WalletLike
  authorizationReady: boolean
  accessToken: () => Promise<string | null>
}
export type WalletReadiness = { canAuthorize: false; walletAuthorizationReady: false; executionEnabled: false; reason: string } | {
  canAuthorize: true; walletAuthorizationReady: boolean; executionEnabled: false; reason: string;
  address: string; walletId: string; signerId: string; policyId: string; policySha256: string; policySummary: string; checkedAt: number
}
export function parseWalletReadiness(value: unknown): WalletReadiness {
  const v = value as Record<string, unknown> | null
  const invalid = () => { throw Error('Wallet verification returned an unsupported response. Launching remains paused.') }
  if (!v || typeof v.canAuthorize !== 'boolean' || typeof v.walletAuthorizationReady !== 'boolean' || v.executionEnabled !== false || typeof v.reason !== 'string') return invalid()
  if (v.canAuthorize === false) {
    if (v.walletAuthorizationReady !== false) return invalid()
    return { canAuthorize: false, walletAuthorizationReady: false, executionEnabled: false, reason: v.reason }
  }
  for (const key of ['address', 'walletId', 'signerId', 'policyId', 'policySha256', 'policySummary']) if (typeof v[key] !== 'string' || !String(v[key]).trim()) return invalid()
  if (!/^[a-f0-9]{64}$/.test(String(v.policySha256)) || !Number.isSafeInteger(v.checkedAt) || Number(v.checkedAt) <= 0 || String(v.policySummary).length > 2000) return invalid()
  return v as WalletReadiness
}
export function canDelegateWallet(v: WalletReadiness | null, address: string | undefined, walletId: string | undefined, signerId: string | undefined, policyId: string | undefined, now = Date.now()): boolean {
  return !!v?.canAuthorize && !v.walletAuthorizationReady && v.address === address && v.walletId === walletId &&
    !!signerId && !!policyId && v.signerId === signerId && v.policyId === policyId && now >= v.checkedAt && now - v.checkedAt < 60_000
}
export async function verifyAgentWallet(walletId: string, address: string, token: string | null): Promise<WalletReadiness> {
  if (!token) throw Error('Sign in again to verify your agent wallet.')
  const response = await fetch('/api/agent-wallet/readiness', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ walletId, address }), signal: AbortSignal.timeout(10_000), cache: 'no-store',
  })
  if (!response.ok) throw Error('Agent wallet verification is unavailable. Your wallet is not enabled for trading.')
  const result = parseWalletReadiness(await response.json())
  if (result.canAuthorize && (result.walletId !== walletId || result.address !== address)) throw Error('Wallet verification identity did not match.')
  return result
}

// An injected Phantom/Solflare account is deliberately not eligible for this role.
export function embeddedSolanaAccounts(accounts: unknown[]): { address: string; walletId: string }[] {
  return accounts.flatMap(value => {
    const a = value as Record<string, unknown> | null
    return a && a.type === 'wallet' && a.chainType === 'solana' && a.connectorType === 'embedded' &&
      ['privy', 'privy-v2'].includes(String(a.walletClientType)) && a.imported === false &&
      typeof a.id === 'string' && !!a.id && typeof a.address === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.address)
      ? [{ address: a.address, walletId: a.id }] : []
  })
}
