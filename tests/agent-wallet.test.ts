import assert from 'node:assert/strict'
import test from 'node:test'
import { canDelegateWallet, embeddedSolanaAccounts, parseWalletReadiness, PUBLIC_AGENT_LAUNCHES_ENABLED, verifyAgentWallet } from '../src/data/agentWallet.ts'
const address = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const evidence = { canAuthorize: true, walletAuthorizationReady: false, executionEnabled: false, reason: 'delegation-required', address, walletId: 'wallet1', signerId: 'signer1', policyId: 'policy1', policySha256: 'a'.repeat(64), policySummary: 'Reviewed bounded policy', checkedAt: 10_000 }
test('only newly created embedded Solana accounts qualify; external or imported wallets do not', () => {
  const account = { type: 'wallet', chainType: 'solana', connectorType: 'embedded', walletClientType: 'privy', imported: false, id: 'wallet1', address }
  assert.deepEqual(embeddedSolanaAccounts([account]), [{ walletId: 'wallet1', address }])
  for (const delta of [{ walletClientType: 'phantom' }, { connectorType: 'injected' }, { imported: true }, { imported: undefined }, { id: null }, { chainType: 'ethereum' }, { address: 'bad' }]) assert.deepEqual(embeddedSolanaAccounts([{ ...account, ...delta }]), [])
})
test('readiness rejects contradictory execution, authorization and incomplete policy evidence', () => {
  for (const value of [null, {}, { ...evidence, executionEnabled: true }, { ...evidence, canAuthorize: false, walletAuthorizationReady: true }, { ...evidence, policySha256: 'bad' }, { ...evidence, checkedAt: Infinity }, { ...evidence, signerId: '' }]) assert.throws(() => parseWalletReadiness(value))
  assert.equal(parseWalletReadiness({ canAuthorize: false, walletAuthorizationReady: false, executionEnabled: false, reason: 'configuration-missing' }).canAuthorize, false)
  assert.equal(PUBLIC_AGENT_LAUNCHES_ENABLED, false)
})
test('delegation binds the reviewed identity and exact policy IDs, and expires', () => {
  const v = parseWalletReadiness(evidence)
  assert.equal(canDelegateWallet(v, address, 'wallet1', 'signer1', 'policy1', 10_001), true)
  for (const args of [['another', 'wallet1', 'signer1', 'policy1'], [address, 'wallet2', 'signer1', 'policy1'], [address, 'wallet1', 'other', 'policy1'], [address, 'wallet1', 'signer1', 'other'], [address, 'wallet1', undefined, 'policy1']]) assert.equal(canDelegateWallet(v, ...args as [string, string, string, string], 10_001), false)
  assert.equal(canDelegateWallet(v, address, 'wallet1', 'signer1', 'policy1', 70_000), false)
  assert.equal(canDelegateWallet(v, address, 'wallet1', 'signer1', 'policy1', 9_999), false)
  assert.equal(canDelegateWallet(parseWalletReadiness({ ...evidence, walletAuthorizationReady: true }), address, 'wallet1', 'signer1', 'policy1', 10_001), false)
})
test('verification refuses mismatched wallet responses and sends no request without login', async () => {
  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ ...evidence, address: 'other' }), { status: 200 }) }
  try {
    await assert.rejects(verifyAgentWallet('wallet1', address, null), /Sign in/)
    assert.equal(requests, 0)
    await assert.rejects(verifyAgentWallet('wallet1', address, 'test-only-token'), /identity/)
    assert.equal(requests, 1)
  } finally { globalThis.fetch = original }
})
