import { PrivyClient } from '@privy-io/node'
import type { PrivyReadinessConfig, PrivyReadinessProvider } from './_privy-readiness.js'

type Env = Record<string, string | undefined>

/** Null until every server value is present. The app secret never leaves this module. */
export function privyReadinessConfig(env: Env = process.env): PrivyReadinessConfig | null {
  const appId = env.PRIVY_APP_ID?.trim(), signerId = env.PRIVY_AGENT_SIGNER_ID?.trim()
  const policyId = env.PRIVY_AGENT_POLICY_ID?.trim(), policySha256 = env.PRIVY_AGENT_POLICY_SHA256?.trim().toLowerCase()
  const policySummary = env.PRIVY_AGENT_POLICY_SUMMARY?.trim()
  if (!appId || !signerId || !policyId || !policySha256 || !policySummary || !env.PRIVY_APP_SECRET?.trim()) return null
  return { appId, signerId, policyId, policySha256, policySummary }
}

/** Minimal slice of the SDK this adapter reads, so tests can supply raw-shaped resources. */
export interface PrivySdkReads {
  verifyAccessToken(token: string): Promise<{ app_id: string; user_id: string; issuer: string; expiration: number; issued_at: number }>
  getUser(id: string): Promise<{ id: string; linked_accounts: unknown[] }>
  getWallet(id: string): Promise<{ id: string; address: string; chain_type: string; owner_id: string | null
    additional_signers?: Array<{ signer_id: string; override_policy_ids?: string[] | null }> }>
  getPolicy(id: string): Promise<{ id: string; version: string; chain_type: string; owner_id: string | null; rules: unknown[] }>
}

export function sdkReads(env: Env = process.env): PrivySdkReads {
  const client = new PrivyClient({ appId: env.PRIVY_APP_ID!.trim(), appSecret: env.PRIVY_APP_SECRET!.trim() })
  return {
    verifyAccessToken: token => client.utils().auth().verifyAccessToken(token),
    getUser: id => client.users()._get(id),
    getWallet: id => client.wallets().get(id),
    getPolicy: id => client.policies().get(id),
  }
}

const embeddedSolana = (value: unknown) => {
  const a = value as Record<string, unknown> | null
  return !!a && a.type === 'wallet' && a.chain_type === 'solana' && a.connector_type === 'embedded'
    && a.wallet_client_type === 'privy' && a.imported === false && typeof a.id === 'string' && typeof a.address === 'string'
}

/**
 * Maps raw SDK resources onto the normalized readiness contract.
 * Privy's wallet `owner_id` is a key quorum, not a user DID: ownership is proven by the wallet being an
 * embedded (non-imported) Solana account linked to the verified user, plus a non-null owner quorum on the
 * wallet resource. Anything else reports no owner, so the verifier fails closed.
 */
export function privyReadinessProvider(sdk: PrivySdkReads): PrivyReadinessProvider {
  let linkedFor: { userId: string; walletIds: Set<string> } | null = null
  return {
    async verifyAccessToken(token) {
      const c = await sdk.verifyAccessToken(token)
      return { appId: c.app_id, userId: c.user_id, issuer: c.issuer, expiration: c.expiration, issuedAt: c.issued_at }
    },
    async getUser(id) {
      const user = await sdk.getUser(id)
      const wallets = (user.linked_accounts || []).filter(embeddedSolana).map(value => {
        const a = value as Record<string, string>
        return { id: a.id, address: a.address, chainType: 'solana', walletClientType: 'privy' }
      })
      linkedFor = { userId: user.id, walletIds: new Set(wallets.map(w => w.id)) }
      return { id: user.id, wallets }
    },
    async getWallet(id) {
      const w = await sdk.getWallet(id)
      const owned = !!w.owner_id && !!linkedFor && linkedFor.walletIds.has(w.id)
      return {
        id: w.id, address: w.address, chainType: w.chain_type,
        ownerUserId: owned ? linkedFor!.userId : null,
        additionalSigners: (w.additional_signers || []).map(s => ({ signerId: s.signer_id, overridePolicyIds: s.override_policy_ids || [] })),
      }
    },
    async getPolicy(id) {
      const p = await sdk.getPolicy(id)
      return { id: p.id, version: p.version, chainType: p.chain_type, ownerId: p.owner_id || '', rules: p.rules }
    },
  }
}
