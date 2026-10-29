import test from 'node:test'
import assert from 'node:assert/strict'
import { readLaunchStatus, fetchLaunchStatus } from '../src/data/launchStatus.ts'
const wallet = '11111111111111111111111111111111'
const base = { open: true, reason: null, walletModel: 'launcher', oneAgentPerWallet: true }
test('launch availability uses wallet ownership, never a spare-wallet count', () => {
  assert.equal(readLaunchStatus({ ...base, free: 0, ownerState: { state: 'available' } }, true).open, true)
  for (const state of ['reserved', 'confirmed', 'review']) {
    const result = readLaunchStatus({ ...base, free: 999, ownerState: { state } }, true)
    assert.equal(result.open, false)
    assert.ok(result.reason)
  }
  assert.equal(readLaunchStatus({ ...base, open: false, reason: 'Executor unavailable', ownerState: { state: 'available' } }, true).open, false)
})
test('missing or malformed owner status cannot authorize a launch', () => {
  for (const status of [null, {}, { ...base, open: 'true' }, { ...base, walletModel: 'pool' }, base, { ...base, ownerState: { state: 'unknown' } }, { ...base, ownerState: { state: 'available', mint: 'invalid' } }]) {
    assert.throws(() => readLaunchStatus(status, true))
  }
})
test('wallet preflight requests uncached owner status and rejects HTTP failure', async () => {
  const controller = new AbortController()
  const fake = (async (url, init) => {
    assert.equal(url, `/api/launch/status?launcher=${wallet}`)
    assert.equal(init?.cache, 'no-store')
    assert.equal(init?.signal, controller.signal)
    return new Response(JSON.stringify({ ...base, ownerState: { state: 'available' } }))
  }) as typeof fetch
  assert.equal((await fetchLaunchStatus(wallet, controller.signal, fake)).open, true)
  await assert.rejects(fetchLaunchStatus(wallet, undefined, (async () => new Response('{}', { status: 503 })) as typeof fetch))
  await assert.rejects(fetchLaunchStatus('not-an-address', undefined, fake))
})
