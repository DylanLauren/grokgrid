import test from 'node:test'
import assert from 'node:assert/strict'
import { privyPolicyFingerprint, verifyPrivyWalletReadiness, type PrivyReadinessProvider } from '../api/_privy-readiness.ts'

function fixture() {
  const now = 1_800_000_000_000
  const address = 'So11111111111111111111111111111111111111112'
  const claims = { appId: 'test-app', userId: 'did:privy:test-user', issuer: 'privy.io', issuedAt: now / 1000 - 10, expiration: now / 1000 + 60 }
  const user = { id: claims.userId, wallets: [{ id: 'test-wallet', address, chainType: 'solana', walletClientType: 'privy' }] }
  const wallet = { id: 'test-wallet', address, chainType: 'solana', ownerUserId: claims.userId,
    additionalSigners: [{ signerId: 'test-signer', overridePolicyIds: ['test-policy'] }] }
  const policy = { id: 'test-policy', version: '1.0', chainType: 'solana', ownerId: 'test-policy-owner', rules: [
    { method: 'signAndSendTransaction', action: 'ALLOW', conditions: [{ field: 'amount', operator: 'lte', value: '100' }] },
  ] }
  const calls: string[] = []
  const provider: PrivyReadinessProvider = {
    async verifyAccessToken(token) { assert.equal(token, 'test-access-token'); calls.push('auth'); return claims },
    async getUser(id) { assert.equal(id, claims.userId); calls.push('user'); return user },
    async getWallet(id) { assert.equal(id, wallet.id); calls.push('wallet'); return wallet },
    async getPolicy(id) { assert.equal(id, policy.id); calls.push('policy'); return policy },
  }
  const config = { appId: claims.appId, signerId: 'test-signer', policyId: 'test-policy', policySha256: privyPolicyFingerprint(policy), policySummary: 'Reviewed fixture amount limit 100; execution disabled.' }
  const input = { accessToken: 'test-access-token', walletId: wallet.id, address }
  return { now, claims, user, wallet, policy, provider, config, input, calls,
    verify: () => verifyPrivyWalletReadiness(input, config, provider, now) }
}

test('fresh authoritative embedded ownership plus exact policy proves authorization, never execution', async () => {
  const f = fixture(), result = await f.verify()
  assert.equal(result.walletAuthorizationReady, true)
  assert.equal(result.executionEnabled, false)
  assert.deepEqual(f.calls, ['auth', 'user', 'wallet', 'policy'])
  assert.ok(!JSON.stringify(result).includes(f.input.accessToken))
})

test('missing configuration and invalid input make no provider calls', async () => {
  const f = fixture(); f.config.policySha256 = ''
  assert.equal((await f.verify()).reason, 'configuration-missing')
  assert.deepEqual(f.calls, [])
  const g = fixture(); g.input.address = 'not a Solana address'
  assert.equal((await g.verify()).reason, 'invalid-request')
  assert.deepEqual(g.calls, [])
})

test('wrong app, issuer, expired or future-issued token fails before wallet lookup', async () => {
  for (const patch of [{ appId: 'another-app' }, { issuer: 'another-issuer' }, { expiration: 1_800_000_000 }, { issuedAt: 1_800_000_001 }]) {
    const f = fixture(); Object.assign(f.claims, patch)
    assert.equal((await f.verify()).reason, 'authentication-failed')
    assert.deepEqual(f.calls, ['auth'])
  }
})

test('external wallet, absent linked wallet and different owner fail closed', async () => {
  const external = fixture(); external.user.wallets[0].walletClientType = 'phantom'
  assert.equal((await external.verify()).reason, 'ownership-not-verified')
  assert.deepEqual(external.calls, ['auth', 'user'])
  const absent = fixture(); absent.user.wallets = []
  assert.equal((await absent.verify()).reason, 'ownership-not-verified')
  const other = fixture(); other.wallet.ownerUserId = 'did:privy:someone-else'
  assert.equal((await other.verify()).reason, 'ownership-not-verified')
})

test('wrong wallet resource, address, chain or duplicate link cannot satisfy requested wallet', async () => {
  for (const patch of [{ address: '11111111111111111111111111111111' }, { chainType: 'ethereum' }]) {
    const f = fixture(); Object.assign(f.wallet, patch)
    assert.equal((await f.verify()).reason, 'ownership-not-verified')
  }
  const f = fixture(); f.user.wallets.push({ ...f.user.wallets[0] })
  assert.equal((await f.verify()).reason, 'ownership-not-verified')
})

test('unexpected or unscoped signers are never ready', async () => {
  for (const grants of [[{ signerId: 'other', overridePolicyIds: ['test-policy'] }],
    [{ signerId: 'test-signer', overridePolicyIds: [] }],
    [{ signerId: 'test-signer', overridePolicyIds: ['test-policy', 'broad-policy'] }],
    [{ signerId: 'test-signer', overridePolicyIds: ['test-policy'] }, { signerId: 'extra', overridePolicyIds: [] }]]) {
    const f = fixture(); f.wallet.additionalSigners = grants
    assert.equal((await f.verify()).reason, 'delegation-not-verified')
  }
})

test('policy mutation at the same ID invalidates the reviewed fingerprint', async () => {
  const f = fixture(); f.policy.rules[0].conditions[0].value = '1000000'
  assert.equal((await f.verify()).reason, 'policy-not-approved')
  const g = fixture(); g.policy.chainType = 'ethereum'
  assert.equal((await g.verify()).reason, 'policy-not-approved')
  const h = fixture(); h.policy.ownerId = 'different-policy-owner'
  assert.equal((await h.verify()).reason, 'policy-not-approved')
})

test('fingerprint ignores object key ordering but preserves rule ordering and rejects non-JSON', () => {
  const f = fixture()
  const same = { ...f.policy, rules: [{ conditions: f.policy.rules[0].conditions, action: 'ALLOW', method: 'signAndSendTransaction' }] }
  assert.equal(privyPolicyFingerprint(same), f.config.policySha256)
  const policy = { ...f.policy, rules: [{ action: 'ALLOW' }, { action: 'DENY' }] }
  assert.notEqual(privyPolicyFingerprint(policy), privyPolicyFingerprint({ ...policy, rules: [...policy.rules].reverse() }))
  assert.throws(() => privyPolicyFingerprint({ ...policy, rules: [undefined] }))
})

test('provider errors are redacted and a prior successful response does not cache revoked authority', async () => {
  const f = fixture(); assert.equal((await f.verify()).walletAuthorizationReady, true)
  f.wallet.additionalSigners = []
  const revoked = await f.verify()
  assert.equal(revoked.reason, 'delegation-required')
  assert.equal(revoked.walletAuthorizationReady, false)
  f.provider.getUser = async () => { throw new Error('sensitive-token-do-not-return') }
  const result = await f.verify()
  assert.equal(result.reason, 'provider-unavailable')
  assert.ok(!JSON.stringify(result).includes('sensitive-token'))
})

test('adding a signer is eligible only after ownership and the current reviewed policy are verified', async () => {
  const f = fixture(); f.wallet.additionalSigners = []
  const result = await f.verify()
  assert.equal(result.canAuthorize, true)
  assert.equal(result.walletAuthorizationReady, false)
  assert.equal(result.reason, 'delegation-required')
  assert.equal(result.canAuthorize && result.policySummary, f.config.policySummary)
  assert.equal(result.canAuthorize && result.signerId, f.config.signerId)
  assert.equal(result.canAuthorize && result.policyId, f.config.policyId)
  f.policy.rules[0].conditions[0].value = '1000000'
  const changed = await f.verify()
  assert.equal(changed.canAuthorize, false)
  assert.equal('policySummary' in changed, false)
})
