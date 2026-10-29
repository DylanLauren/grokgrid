import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeLaunchEvents } from '../api/_launch-events'
import { verifiedWalletId } from '../api/launch/prepare'

const mint = '11111111111111111111111111111111'
const wallet = 'So11111111111111111111111111111111111111112'
const row = (extra: Record<string, unknown>) => ['1', mint, JSON.stringify({ id: 'grid-test', mint, wallet, ts: 1234, ...extra })]

test('launch events carry the verified Privy wallet id, and older events simply lack it', () => {
  assert.equal(decodeLaunchEvents(['1', [row({ privyWalletId: 'wallet_abc-1' })]], '0', 50).events[0].privyWalletId, 'wallet_abc-1')
  assert.equal('privyWalletId' in decodeLaunchEvents(['1', [row({})]], '0', 50).events[0], false)
  for (const bad of [5, '', 'has space', 'x'.repeat(129)]) assert.throws(() => decodeLaunchEvents(['1', [row({ privyWalletId: bad })]], '0', 50))
})

test('without Privy configured, no launch wallet id can be verified', async () => {
  for (const k of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'PRIVY_AGENT_SIGNER_ID', 'PRIVY_AGENT_POLICY_ID']) delete process.env[k]
  const req = new Request('https://x/api/launch/prepare', { method: 'POST', headers: { authorization: 'Bearer t' } })
  assert.equal(await verifiedWalletId(req, 'w1', wallet), null)
})
