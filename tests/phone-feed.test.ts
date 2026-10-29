import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Pure Node module has no declarations.
import { capabilityExpiry, validateConfig, verifyWindow, browserViewportCrop, encodePhoneCapture, captureAndSend, retryPolicy, safeFailure } from '../scripts/phone-feed-core.mjs'
const now = 1_800_000_000_000
const token = `screen-v1.${Math.floor(now / 1000) + 3600}.${'a'.repeat(32)}.${'b'.repeat(64)}`
const config = validateConfig({ source: 'grok-bot-actual-window', windowId: 99, ownerPid: 123, bundleId: 'com.google.Chrome', title: 'Pump', browserUrl: 'https://pump.fun/', tokenFile: '/private/token', statusFile: '/private/status' })
const snapshot = { id: 99, pid: 123, bundleId: 'com.google.Chrome', title: 'Pump', browserUrl: 'https://pump.fun/', onScreen: true, layer: 0, bounds: { x: 10, y: 20, width: 400, height: 800 }, viewport: { innerWidth: 400, innerHeight: 713, outerWidth: 400, outerHeight: 800, devicePixelRatio: 2, href: 'https://pump.fun/' } }
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

test('verified offscreen source waits indefinitely without consuming failure budget, then resumes same source', async () => {
  // @ts-expect-error Pure Node module has no declarations.
  const { captureFailureState } = await import('../scripts/phone-feed-core.mjs')
  let visible = false, captures = 0, sends = 0, failures = 3
  const deps = { token, now: () => now, inspect: async () => ({ ...snapshot, onScreen: visible }), capture: async () => { captures++; return jpeg }, send: async () => { sends++ } }
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await captureAndSend(config, deps); assert.fail('must wait') } catch (error) {
      const code = safeFailure(error)
      assert.equal(code, 'window-temporarily-unavailable')
      const next = captureFailureState(failures, code)
      assert.equal(next.stop, false)
      assert.equal(next.delayMs, 5000)
      assert.equal(next.state, 'waiting-for-window')
      failures = next.failures
    }
  }
  assert.equal(failures, 3)
  assert.equal(captures, 0); assert.equal(sends, 0)
  visible = true
  await captureAndSend(config, deps)
  assert.equal(captures, 1); assert.equal(sends, 1)
})
test('offscreen source still requires exact ID, PID, title, URL, valid geometry and explicit visibility', () => {
  for (const change of [{ id: 100 }, { pid: 124 }, { title: 'Other' }, { bundleId: 'other.browser' }, { browserUrl: 'https://pump.fun/settings' }, { layer: 1 }, { bounds: { ...snapshot.bounds, width: 2000 } }, { onScreen: undefined }]) {
    assert.throws(() => verifyWindow({ ...snapshot, onScreen: false, ...change }, config), (error: unknown) => error instanceof Error && error.message !== 'window-temporarily-unavailable')
  }
  assert.throws(() => verifyWindow(null, config), /window-unavailable/)
})
test('becoming offscreen during capture discards the frame and waits without upload', async () => {
  let inspected = 0, captured = 0
  await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => ({ ...snapshot, onScreen: inspected++ === 0 }), capture: async () => { captured++; return jpeg }, send: async () => assert.fail('must not upload') }), /window-temporarily-unavailable/)
  assert.equal(captured, 1)
})
test('temporary visibility does not reset genuine failures or weaken expiry/auth stops', async () => {
  // @ts-expect-error Pure Node module has no declarations.
  const { captureFailureState } = await import('../scripts/phone-feed-core.mjs')
  const waiting = captureFailureState(7, 'window-temporarily-unavailable')
  assert.equal(waiting.failures, 7)
  assert.equal(captureFailureState(waiting.failures, 'ingest-unavailable').stop, true)
  assert.equal(captureFailureState(0, 'screen-credential-invalid-or-expiring').stop, true)
  assert.equal(captureFailureState(0, 'credential-rejected').stop, true)
})


test('capture prefers780px and retries smaller only when the encoded byte limit requires it', async () => {
  const oversized = Buffer.alloc(330_001)
  let widths: number[] = []
  const best = await encodePhoneCapture(1040, async (width: number) => { widths.push(width); return jpeg })
  assert.equal(best, jpeg); assert.deepEqual(widths, [780])
  widths = []
  const fallback = await encodePhoneCapture(1040, async (width: number) => { widths.push(width); return width === 780 ? oversized : jpeg })
  assert.equal(fallback, jpeg); assert.deepEqual(widths, [780, 520])
  widths = []
  await assert.rejects(encodePhoneCapture(1040, async (width: number) => { widths.push(width); return oversized }), /capture-invalid/)
  assert.deepEqual(widths, [780, 520, 390])
})
test('capture never upsamples smaller sources or accepts malformed encoded data', async () => {
  const widths: number[] = []
  await encodePhoneCapture(320, async (width: number) => { widths.push(width); return jpeg })
  assert.deepEqual(widths, [320])
  await assert.rejects(encodePhoneCapture(0, async () => assert.fail('must not encode')), /capture-invalid/)
  await assert.rejects(encodePhoneCapture(Number.NaN, async () => assert.fail('must not encode')), /capture-invalid/)
  await assert.rejects(encodePhoneCapture(1040, async () => Buffer.from('invalid')), /capture-invalid/)
})


test('viewport crop removes only top browser chrome at native and Retina scales and browser zoom', () => {
  const page = { ...snapshot, bounds: { x: 0, y: 0, width: 520, height: 850 }, viewport: { innerWidth: 520, innerHeight: 763, outerWidth: 520, outerHeight: 850, devicePixelRatio: 2, href: config.browserUrl } }
  assert.deepEqual(browserViewportCrop(page, 1040, 1700), { top: 174, left: 0, width: 1040, height: 1526 })
  assert.deepEqual(browserViewportCrop({ ...page, viewport: { ...page.viewport, devicePixelRatio: 1 } }, 520, 850), { top: 87, left: 0, width: 520, height: 763 })
  assert.deepEqual(browserViewportCrop({ ...page, viewport: { ...page.viewport, innerWidth: 416, innerHeight: 610, devicePixelRatio: 2.5 } }, 1040, 1700), { top: 175, left: 0, width: 1040, height: 1525 })
})
test('viewport crop fails closed for missing, stale URL/bounds, inconsistent scale and out-of-bounds metrics', () => {
  const page = { ...snapshot, bounds: { x: 0, y: 0, width: 520, height: 850 }, viewport: { innerWidth: 520, innerHeight: 763, outerWidth: 520, outerHeight: 850, devicePixelRatio: 2, href: config.browserUrl } }
  for (const change of [{ innerWidth: 0 }, { innerHeight: Number.NaN }, { innerHeight: 900 }, { innerHeight: 400 }, { outerWidth: 600 }, { devicePixelRatio: 1 }, { href: 'https://pump.fun/settings' }]) assert.throws(() => browserViewportCrop({ ...page, viewport: { ...page.viewport, ...change } }, 1040, 1700), /browser-viewport-invalid/)
  assert.throws(() => browserViewportCrop({ ...page, viewport: null }, 1040, 1700), /browser-viewport-invalid/)
  assert.throws(() => browserViewportCrop(page, 1040, 1400), /browser-viewport-invalid/)
  assert.throws(() => browserViewportCrop(page, 0, 1700), /browser-viewport-invalid/)
})
test('Chrome never captures without viewport metrics and never uploads if viewport changes mid-capture', async () => {
  await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => ({ ...snapshot, viewport: null }), capture: async () => assert.fail('must not capture'), send: async () => assert.fail('must not upload') }), /browser-viewport-invalid/)
  let reads = 0
  await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => reads++ ? { ...snapshot, viewport: { ...snapshot.viewport, innerHeight: 700 } } : snapshot, capture: async (before: typeof snapshot) => { assert.deepEqual(before.viewport, snapshot.viewport); return jpeg }, send: async () => assert.fail('must not upload') }), /window-changed-during-capture/)
})


test('missing pinned CG window waits without capture or failure exhaustion and requires the full same identity on return', async () => {
  const { captureFailureState } = await import('../scripts/phone-feed-core.mjs')
  for (let i = 0; i < 12; i++) {
    await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => null, capture: async () => assert.fail('must not capture missing window'), send: async () => assert.fail('must not upload') }), /window-unavailable/)
    assert.deepEqual(captureFailureState(7, 'window-unavailable'), { failures: 7, state: 'waiting-for-window', stop: false, delayMs: 5000 })
  }
  await assert.rejects(captureAndSend(config, { token, now: () => now, inspect: async () => ({ ...snapshot, id: 100 }), capture: async () => assert.fail('must not substitute another window'), send: async () => assert.fail('must not upload') }), /window-identity-mismatch/)
  let sent = 0
  await captureAndSend(config, { token, now: () => now, inspect: async () => snapshot, capture: async () => jpeg, send: async () => { sent++ } })
  assert.equal(sent, 1)
})
