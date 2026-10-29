import test from 'node:test'
import assert from 'node:assert/strict'
import { followMints, targetPage, pageAllowed, titleAllowed, coinUrl, FOLLOW_TTL_MS, RECENT_TRADE_MS } from '../scripts/phone-follow-core.mjs'
import { verifyWindow } from '../scripts/phone-feed-core.mjs'

const now = 1_800_000_000_000, PROFILE = 'https://pump.fun/profile/GrokGrid'
const A = 'ANVLA6eKiAq4nstD2Sg3SZhfVkSEwfnGccn12UQWpump', B = '9KhzhyM1BwgW6myZRcqdzQvemKjVrjck8kaevTkMpump'
const i = (side: string, mint: string, at: number, state = 'reconciled-confirmed') => ({ side, mint, createdAt: at, state })

test('follows only coins the house itself traded (never airdropped inventory), newest first; idle shows the profile', () => {
  assert.deepEqual(followMints({ intents: [i('buy', A, now - 60000), i('buy', B, now - 1000)] }, now), [B, A])
  assert.deepEqual(followMints({ intents: [i('buy', A, now - 60000), i('sell', A, now - 1000)] }, now), [A]) // just sold: still on screen
  assert.deepEqual(followMints({ intents: [i('buy', A, now - 600000), i('sell', A, now - RECENT_TRADE_MS - 1)] }, now), [])
  assert.deepEqual(followMints({ intents: [i('buy', A, now, 'expired')] }, now), [])
  assert.deepEqual(followMints({ intents: [i('buy', 'not a mint', now)] }, now), []) // only real mints, only from the journal
  assert.equal(targetPage([B, A], PROFILE), coinUrl(B)); assert.equal(targetPage([], PROFILE), PROFILE)
})

test('only the profile or a coin on a fresh follow list is allowed; titles must be pump.fun pages', () => {
  const follow = { mints: [A], updatedAt: now - 1000 }
  assert.equal(pageAllowed(PROFILE, PROFILE, null, now), true)
  assert.equal(pageAllowed(coinUrl(A), PROFILE, follow, now), true)
  assert.equal(pageAllowed(coinUrl(B), PROFILE, follow, now), false) // not on the list
  assert.equal(pageAllowed(coinUrl(A), PROFILE, { ...follow, updatedAt: now - FOLLOW_TTL_MS - 1 }, now), false) // stale list
  assert.equal(pageAllowed(coinUrl(A) + '?x=1', PROFILE, follow, now), false)
  assert.equal(pageAllowed('https://evil.example/coin/' + A, PROFILE, follow, now), false)
  assert.equal(pageAllowed(PROFILE + '?tab=closed', PROFILE, follow, now), false)
  assert.equal(titleAllowed('GrokGrid | Pump', 'GrokGrid | Pump'), true)
  assert.equal(titleAllowed('Hexncoin (HEXN) Price, Chart & Market Cap | Pump', 'GrokGrid | Pump'), true)
  assert.equal(titleAllowed('Some other site', 'GrokGrid | Pump'), false)
})

test('the screenshot feed accepts a followed coin page in the same pinned window, nothing else', () => {
  const config = { windowId: 1300, ownerPid: 7, bundleId: 'com.google.Chrome', title: 'GrokGrid | Pump', browserUrl: PROFILE }
  const snap = (patch: Record<string, unknown> = {}) => ({ id: 1300, pid: 7, bundleId: 'com.google.Chrome', title: 'GrokGrid | Pump', onScreen: true, layer: 0, bounds: { x: 10, y: 40, width: 406, height: 851 },
    browserUrl: PROFILE, viewport: { innerWidth: 406, innerHeight: 819, outerWidth: 406, outerHeight: 851, devicePixelRatio: 2, href: PROFILE }, ...patch })
  const coin = coinUrl(A), onCoin = { title: 'Hexncoin (HEXN) Price, Chart & Market Cap | Pump', browserUrl: coin, viewport: { ...snap().viewport, href: coin } }
  assert.ok(verifyWindow(snap(), config, null, now))
  assert.ok(verifyWindow(snap(onCoin), config, { mints: [A], updatedAt: now }, now))
  assert.throws(() => verifyWindow(snap(onCoin), config, null, now), /browser-url-mismatch/)
  assert.throws(() => verifyWindow(snap({ ...onCoin, id: 1301 }), config, { mints: [A], updatedAt: now }, now), /window-identity-mismatch/)
  assert.throws(() => verifyWindow(snap({ title: 'Inbox' }), config, null, now), /window-identity-mismatch/)
})

test('a just-posted callout puts its coin on the phone for 30 seconds, only for a coin the house traded', async () => {
  const { calloutMint, CALLOUT_SHOW_MS } = await import('../scripts/phone-follow-core.mjs')
  const ledger = (outcome: string, at: number, mint = A) => ({ calls: [{ at, mint, outcome }] })
  assert.equal(calloutMint(ledger('posted', now - 5000), [B, A], now), A)
  assert.equal(targetPage([B, A], PROFILE, calloutMint(ledger('posted', now - 5000), [B, A], now)), coinUrl(A)) // ahead of the newest trade
  assert.equal(calloutMint(ledger('posted', now - CALLOUT_SHOW_MS), [A], now), null) // shown long enough
  assert.equal(calloutMint(ledger('verdict-INSUFFICIENT_BALANCE', now - 5000), [A], now), null) // refused callouts show nothing
  assert.equal(calloutMint(ledger('posted', now - 5000, 'So11111111111111111111111111111111111111112'), [A], now), null) // not a coin the house traded
  assert.equal(calloutMint(null, [A], now), null)
})
