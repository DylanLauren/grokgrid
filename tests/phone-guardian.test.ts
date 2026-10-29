import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GUARDIAN, windowFixes, shouldResume, HIDE_SCROLLBAR_JS } from '../scripts/phone-guardian-core.mjs'

const URL = 'https://pump.fun/profile/GrokGrid', B = DEFAULT_GUARDIAN.bounds
const w = (patch: Record<string, unknown> = {}) => ({ fullScreen: false, url: URL, bounds: { ...B }, ...patch })

test('puts the pinned window back: out of full screen, phone size, on the house profile', () => {
  assert.deepEqual(windowFixes(w(), URL, B), [])
  assert.deepEqual(windowFixes(w({ fullScreen: true, bounds: { x: 0, y: 33, width: 1470, height: 923 } }), URL, B), ['exit-full-screen', 'restore-bounds'])
  assert.deepEqual(windowFixes(w({ url: URL + '?tab=closed' }), URL, B), ['show-target'])
  assert.deepEqual(windowFixes(w({ url: 'https://example.com/' }), URL, B), []) // never navigates away from another site
  const coin = 'https://pump.fun/coin/ANVLA6eKiAq4nstD2Sg3SZhfVkSEwfnGccn12UQWpump'
  assert.deepEqual(windowFixes(w(), URL, B, coin), ['show-target']) // follow the house to the coin it trades
  assert.deepEqual(windowFixes(w({ url: coin }), URL, B, coin), [])
  assert.deepEqual(windowFixes(w({ url: coin }), URL, B), ['show-target']) // back to the profile when idle
  assert.deepEqual(windowFixes(w({ bounds: { ...B, x: B.x + 1 } }), URL, B), []) // within 2 points
  assert.deepEqual(windowFixes(null as unknown as Record<string, unknown>, URL, B), [])
})

test('resumes only a feed stopped for a window problem, never a manual pause or a credential failure', () => {
  const stopped = { pausedFile: true, appState: 'supervisor-stopped-review-required', supervisorState: 'stopped-needs-operator', supervisorReason: 'phone-window-geometry-invalid' }
  assert.equal(shouldResume(stopped), true)
  assert.equal(shouldResume({ ...stopped, appState: 'paused' }), false)
  assert.equal(shouldResume({ ...stopped, supervisorReason: 'credential-rejected' }), false)
  assert.equal(shouldResume({ ...stopped, pausedFile: false }), false)
  assert.ok(!/fetch|cookie|localStorage|innerText/.test(HIDE_SCROLLBAR_JS)) // style only
})
