import test from 'node:test'
import assert from 'node:assert/strict'
import { privyReadinessConfig, privyReadinessProvider, type PrivySdkReads } from '../api/_privy-provider.ts'
import { privyPolicyFingerprint, verifyPrivyWalletReadiness } from '../api/_privy-readiness.ts'

const now = 1_800_000_000_000
const address = 'So11111111111111111111111111111111111111112'

function rawSdk() {
  const policy = { id: 'pol', version: '1.0', chain_type: 'solana', owner_id: 'policy-owner-quorum',
    rules: [{ method: 'signAndSendTransaction', action: 'ALLOW', conditions: [] }] }
  const linked = { type: 'wallet', chain_type: 'solana', connector_type: 'embedded', wallet_client_type: 'privy',
    imported: false, id: 'w1', address }
  const user = { id: 'did:privy:u1', linked_accounts: [linked] }
  const wallet = { id: 'w1', address, chain_type: 'solana', owner_id: 'user-owner-quorum',
    additional_signers: [{ signer_id: 'sig', override_policy_ids: ['pol'] }] as Array<{ signer_id: string; override_policy_ids?: string[] }> }
  const sdk: PrivySdkReads = {
    async verifyAccessToken() { return { app_id: 'app', user_id: user.id, issuer: 'privy.io', issued_at: now / 1000 - 5, expiration: now / 1000 + 60 } },
    async getUser() { return user },
    async getWallet() { return wallet },
    async getPolicy() { return policy },
  }
  const config = { appId: 'app', signerId: 'sig', policyId: 'pol', policySummary: 'Reviewed limits.',
    policySha256: privyPolicyFingerprint({ id: policy.id, version: policy.version, chainType: policy.chain_type, ownerId: policy.owner_id, rules: policy.rules }) }
  const verify = () => verifyPrivyWalletReadiness({ accessToken: 't', walletId: 'w1', address }, config, privyReadinessProvider(sdk), now)
  return { policy, linked, user, wallet, verify }
}

test('raw SDK resources for a linked embedded wallet with the scoped signer verify, execution stays off', async () => {
  const r = await rawSdk().verify()
  assert.equal(r.reason, 'authorization-verified')
  assert.equal(r.executionEnabled, false)
})

test('imported or unlinked wallets, and a wallet with no owner quorum, are not owned', async () => {
  const a = rawSdk(); a.linked.imported = true
  assert.equal((await a.verify()).reason, 'ownership-not-verified')
  const b = rawSdk(); b.user.linked_accounts = []
  assert.equal((await b.verify()).reason, 'ownership-not-verified')
  const c = rawSdk(); (c.wallet as { owner_id: string | null }).owner_id = null
  assert.equal((await c.verify()).reason, 'ownership-not-verified')
})

test('an unowned policy or an unscoped signer grant fails closed', async () => {
  const a = rawSdk(); (a.policy as { owner_id: string | null }).owner_id = null
  assert.equal((await a.verify()).reason, 'policy-not-approved')
  const b = rawSdk(); b.wallet.additional_signers = [{ signer_id: 'sig' }]
  assert.equal((await b.verify()).reason, 'delegation-not-verified')
  const c = rawSdk(); c.wallet.additional_signers = []
  assert.equal((await c.verify()).reason, 'delegation-required')
})

test('server config needs every value including the secret, which is never returned', () => {
  const env = { PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 's3cr3t', PRIVY_AGENT_SIGNER_ID: 'sig', PRIVY_AGENT_POLICY_ID: 'pol',
    PRIVY_AGENT_POLICY_SHA256: 'A'.repeat(64), PRIVY_AGENT_POLICY_SUMMARY: 'x' }
  const config = privyReadinessConfig(env)
  assert.ok(config && !JSON.stringify(config).includes('s3cr3t'))
  assert.equal(config!.policySha256, 'a'.repeat(64))
  assert.equal(privyReadinessConfig({ ...env, PRIVY_APP_SECRET: '' }), null)
})
