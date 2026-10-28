import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Pure Node module has no declarations.
import { capabilityExpiry, validateConfig, verifyWindow, captureAndSend, retryPolicy, safeFailure } from '../scripts/phone-feed-core.mjs'
const now = 1_800_000_000_000
const token = `screen-v1.${Math.floor(now / 1000) + 3600}.${'a'.repeat(32)}.${'b'.repeat(64)}`
const config = validateConfig({ source: 'grok-bot-actual-window', windowId: 99, ownerPid: 123, bundleId: 'com.google.Chrome', title: 'Pump', browserUrl: 'https://pump.fun/', tokenFile: '/private/token', statusFile: '/private/status' })
const snapshot = { id: 99, pid: 123, bundleId: 'com.google.Chrome', title: 'Pump', browserUrl: 'https://pump.fun/', onScreen: true, layer: 0, bounds: { x: 10, y: 20, width: 400, height: 800 } }
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]) // policy fixture, never used by real capture

test('feed only accepts scoped, unexpired capability and allowlisted destinations', () => {
  assert.equal(capabilityExpiry(token, now), now + 3600_000)
  for (const t of ['full-admin-secret', token.replace(String(now / 1000 + 3600), String(now / 1000)), token.replace(String(now / 1000 + 3600), String(now / 1000 + 8 * 86400))]) assert.throws(() => capabilityExpiry(t, now))
  assert.throws(() => validateConfig({ ...config, site: 'https://attacker.test' }))
  assert.throws(() => validateConfig({ ...config, browserUrl: 'https://attacker.test/pump.fun' }))
  assert.throws(() => validateConfig({ ...config, source: 'demo' }))
  assert.throws(() => validateConfig({ ...config, tokenFile: config.statusFile }))
})
test('identity, minimization and wrong active Chrome URL prevent capture', async () => {
  for (const change of [{ pid: 456 }, { title: 'Vault' }, { onScreen: false }, { browserUrl: 'https://pump.fun/settings' }, { id: 100 }]) {
    let captured = false
    await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => ({ ...snapshot, ...change }), capture: async () => { captured = true; return jpeg }, send: async () => assert.fail('must not upload') }))
    assert.equal(captured, false)
  }
  assert.throws(() => verifyWindow({ ...snapshot, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, config))
})
test('tab or geometry change during capture discards the frame before upload', async () => {
  for (const change of [{ title: 'Vault' }, { bounds: { ...snapshot.bounds, x: 40 } }, { browserUrl: 'https://pump.fun/settings' }]) {
    let inspections = 0
    await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => inspections++ ? { ...snapshot, ...change } : snapshot, capture: async () => jpeg, send: async () => assert.fail('must not upload') }))
  }
})
test('credential expiry during capture prevents upload', async () => {
  let time = now
  await assert.rejects(captureAndSend(config, { token, now: () => time, inspect: async () => snapshot, capture: async () => { time = now + 3600_000; return jpeg }, send: async () => assert.fail('must not upload') }))
})
test('valid unchanged window uploads the exact capture bytes only once', async () => {
  let sends = 0
  const result = await captureAndSend(config, { token, now: () => now, inspect: async () => snapshot, capture: async () => jpeg, send: async (bytes: Buffer) => { assert.equal(bytes, jpeg); sends++ } })
  assert.equal(sends, 1); assert.equal(result.bytes, jpeg.length)
})
test('auth rejection stops; transient failures back off and ultimately stop; errors are sanitized', () => {
  assert.equal(retryPolicy(1, 'credential-rejected').stop, true)
  assert.equal(retryPolicy(1, 'ingest-unavailable').delayMs, 2000)
  assert.equal(retryPolicy(6, 'ingest-unavailable').delayMs, 60_000)
  assert.equal(retryPolicy(8, 'ingest-unavailable').stop, true)
  assert.equal(safeFailure(Error('secret token https://private.test?key=secret')), 'feed-unavailable')
})
