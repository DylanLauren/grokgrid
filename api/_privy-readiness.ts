import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'

/** Only a server SDK adapter may construct this evidence; never spread request JSON into it. */
export interface PrivyReadinessProvider {
  verifyAccessToken(token: string): Promise<{
    appId: string; userId: string; issuer: string; expiration: number; issuedAt: number
  }>
  getUser(id: string): Promise<{
    id: string
    wallets: Array<{ id: string; address: string; chainType: string; walletClientType: string }>
  }>
  getWallet(id: string): Promise<{
    id: string; address: string; chainType: string; ownerUserId: string | null
    additionalSigners: Array<{ signerId: string; overridePolicyIds: string[] }>
  }>
  getPolicy(id: string): Promise<PrivyPolicyEvidence>
}

export interface PrivyPolicyEvidence {
  id: string
  version: string
  chainType: string
  ownerId: string
  rules: unknown[]
}

export interface PrivyReadinessConfig {
  appId: string
  signerId: string
  policyId: string
  /** Hash of independently reviewed rules, not a hash learned from the current request. */
  policySha256: string
  /** Human-reviewed description paired with this exact policy fingerprint. */
  policySummary: string
}

type FailureReason = 'configuration-missing' | 'invalid-request' | 'authentication-failed'
  | 'ownership-not-verified' | 'delegation-not-verified' | 'policy-not-approved' | 'provider-unavailable'
export type PrivyReadinessResult = {
  canAuthorize: false; walletAuthorizationReady: false; executionEnabled: false; reason: FailureReason
} | {
  canAuthorize: true; walletAuthorizationReady: boolean; executionEnabled: false
  reason: 'authorization-verified' | 'delegation-required'
  walletId: string; address: string; userId: string; checkedAt: number; policySha256: string; policySummary: string
  signerId: string; policyId: string
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (typeof value === 'object' && value !== null
      && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const record = value as Record<string, unknown>
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}'
  }
  throw new Error('Policy must contain JSON values only')
}

/** Display name, timestamps and resource ID do not change policy semantics; rule order does. */
export function privyPolicyFingerprint(policy: PrivyPolicyEvidence): string {
  return createHash('sha256').update(canonical({
    version: policy.version, chain_type: policy.chainType, rules: policy.rules, owner_id: policy.ownerId,
  })).digest('hex')
}

const fail = (reason: FailureReason): PrivyReadinessResult => ({ canAuthorize: false, walletAuthorizationReady: false, executionEnabled: false, reason })
const identifier = (value: unknown): value is string => typeof value === 'string'
  && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)

/** Fresh, read-only authorization proof. This does not sign, fund, simulate or enable a worker. */
export async function verifyPrivyWalletReadiness(input: {
  accessToken: unknown; walletId: unknown; address: unknown
}, config: PrivyReadinessConfig, provider: PrivyReadinessProvider, now = Date.now()): Promise<PrivyReadinessResult> {
  if (!identifier(config.appId) || !identifier(config.signerId) || !identifier(config.policyId)
      || !/^[a-f0-9]{64}$/.test(config.policySha256) || typeof config.policySummary !== 'string'
      || !config.policySummary.trim() || config.policySummary.length > 2000) return fail('configuration-missing')
  if (!identifier(input.walletId) || typeof input.address !== 'string'
      || typeof input.accessToken !== 'string' || input.accessToken.length === 0 || input.accessToken.length > 16384
      || !Number.isFinite(now)) return fail('invalid-request')
  try {
    if (new PublicKey(input.address).toBase58() !== input.address) return fail('invalid-request')
  } catch { return fail('invalid-request') }

  let userId: string
  try {
    const claims = await provider.verifyAccessToken(input.accessToken)
    if (claims.appId !== config.appId || claims.issuer !== 'privy.io' || !identifier(claims.userId)
        || !claims.userId.startsWith('did:privy:') || !Number.isFinite(claims.expiration)
        || !Number.isFinite(claims.issuedAt) || claims.expiration * 1000 <= now
        || claims.issuedAt * 1000 > now || claims.issuedAt >= claims.expiration) return fail('authentication-failed')
    userId = claims.userId
  } catch { return fail('authentication-failed') }

  try {
    const user = await provider.getUser(userId)
    const links = user.wallets.filter(wallet => wallet.id === input.walletId && wallet.address === input.address
      && wallet.chainType === 'solana' && wallet.walletClientType === 'privy')
    if (user.id !== userId || links.length !== 1) return fail('ownership-not-verified')
    const wallet = await provider.getWallet(input.walletId)
    if (wallet.id !== input.walletId || wallet.address !== input.address || wallet.chainType !== 'solana'
        || wallet.ownerUserId !== userId) return fail('ownership-not-verified')
    const policy = await provider.getPolicy(config.policyId)
    if (policy.id !== config.policyId || policy.chainType !== 'solana' || policy.version !== '1.0' || !identifier(policy.ownerId)
        || !Array.isArray(policy.rules) || policy.rules.length === 0
        || privyPolicyFingerprint(policy) !== config.policySha256) return fail('policy-not-approved')
    // A dedicated agent wallet has one explicitly scoped app signer. Unscoped/extra grants fail closed.
    if (wallet.additionalSigners.length > 1) return fail('delegation-not-verified')
    const signer = wallet.additionalSigners[0]
    if (signer && (signer.signerId !== config.signerId || signer.overridePolicyIds.length !== 1
        || signer.overridePolicyIds[0] !== config.policyId)) return fail('delegation-not-verified')
    return { canAuthorize: true, walletAuthorizationReady: !!signer, executionEnabled: false,
      reason: signer ? 'authorization-verified' : 'delegation-required',
      walletId: wallet.id, address: wallet.address, userId, checkedAt: now,
      policySha256: config.policySha256, policySummary: config.policySummary,
      signerId: config.signerId, policyId: config.policyId }
  } catch {
    // SDK error strings can include request headers or bearer tokens. Never return or log them here.
    return fail('provider-unavailable')
  }
}
