import test from 'node:test'
import assert from 'node:assert/strict'
import { pickCallout, calloutGate, thesis, pageScript, runCallout } from '../scripts/pump-callouts.mjs'

const now = 1_800_000_000_000
const sig = (n: number) => '5'.repeat(87) + n
const buy = (n: number, mint: string, at: number) => ({ state: 'reconciled-confirmed', side: 'buy', mint, signature: sig(n), createdAt: at, receipt: { spentLamports: '50000000' } })
const A = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', B = 'So11111111111111111111111111111111111111112'
const held = (...m: string[]) => ({ positions: m.map(mint => ({ mint, tokenUnits: '5' })) })

test('calls the newest real buy still held; never paper or sold coins', () => {
  const s = { intents: [buy(1, A, now - 10), buy(2, B, now), { ...buy(3, A, now + 5), state: 'held-ambiguous' }] }
  assert.equal(pickCallout(s, held(A, B))!.signature, sig(2))
  assert.equal(pickCallout(s, held(A))!.signature, sig(1))
  assert.equal(pickCallout(s, held()), null)
  assert.equal(pickCallout(s, held(A, B), { calls: [{ at: now, mint: B, signature: sig(2), outcome: 'posted' }] }, now)!.signature, sig(1)) // next uncalled coin
})

test('gate: off by default, every coin once, no repeat of a signature or a coin within a day', () => {
  const on = { pumpCalloutsEnabled: true }, i = buy(1, A, now)
  assert.equal(calloutGate({ calls: [] }, { pumpCalloutsEnabled: false }, i, now), 'disabled')
  assert.equal(calloutGate({ calls: [] }, on, i, now), 'ok')
  assert.equal(calloutGate({ calls: [{ at: now - 1000, mint: B, signature: sig(9), outcome: 'posted' }] }, on, i, now), 'ok') // another coin just called
  assert.equal(calloutGate({ calls: [{ at: now - 7 * 3600000, mint: A, signature: sig(8), outcome: 'posted' }] }, on, i, now), 'already-called')
  assert.equal(calloutGate({ calls: [] }, on, null, now), 'nothing-held')
})

test('dry run never contains the create call; inputs are JSON-encoded; bad mints never reach Chrome', async () => {
  assert.ok(!pageScript(A, 'x', true).includes('/callout/create'))
  assert.ok(pageScript(A, 'x', false).includes('/callout/create'))
  assert.ok(pageScript(A, 'a"b\\'+'c', false).includes(JSON.stringify('a"b\\'+'c')))
  let ran = false
  assert.equal(await runCallout({ tabUrlPrefix: 'https://pump.fun/' }, 'x"; do shell script "id', 't', true, async () => { ran = true; return { stdout: '' } }), 'invalid-mint')
  assert.equal(ran, false)
  assert.ok(thesis(buy(1, A, now), 'WIF').length <= 280)
})
