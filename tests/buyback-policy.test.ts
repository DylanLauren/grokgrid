import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateBuybackConfig, executionBlockers, plannedSpend, emptyBuybackState, recordBuy, settleLeg, recordBurn, closeEmpty, openCycle } from '../scripts/buyback-policy.mjs'
import { withBuybackStore } from '../scripts/buyback-store.mjs'

const BURN = 'So11111111111111111111111111111111111111112'
const MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SIG = (n: number) => '5'.repeat(87) + String(n)
const config = (over: Record<string, unknown> = {}) => validateBuybackConfig({
  version: 1, executionEnabled: false, signingEnabled: false, burnWallet: BURN, officialMint: MINT, stopFile: '/tmp/grokgrid-stop',
  triggerLamports: '50000000', maxSpendLamports: '1000000000', reserveLamports: '10000000', feeAllowanceLamports: '3000000', maxSlippageBps: 500, ...over,
})
const ready = { stopFilePresent: false, mintVerified: true, keypairMatches: true, observedMint: MINT }

test('default config is blocked on every switch and the stop file', () => {
  const b = executionBlockers(config(), { ...ready, stopFilePresent: true })
  assert.deepEqual(b, ['execution-disabled', 'signing-disabled', 'stop-switch-engaged'])
  assert.deepEqual(executionBlockers(config({ executionEnabled: true, signingEnabled: true, keypairFile: '/k' }), ready), [])
  assert.ok(executionBlockers(config({ executionEnabled: true, signingEnabled: true, keypairFile: '/k' }), { ...ready, stopFilePresent: undefined as unknown as boolean }).includes('stop-switch-engaged'))
  assert.deepEqual(executionBlockers(config({ officialMint: null }), ready).slice(-1), ['awaiting-official-mint'])
  assert.ok(executionBlockers(config({ executionEnabled: true, signingEnabled: true, keypairFile: '/k' }), { ...ready, mintVerified: false }).includes('mint-unverified'))
})

test('spend triggers at 0.05 SOL, keeps the reserve and caps at 1 SOL', () => {
  const c = config()
  assert.equal(plannedSpend(c, '49999999'), null)
  assert.equal(plannedSpend(c, '50000000'), '37000000')
  assert.equal(plannedSpend(c, '5000000000'), '1000000000')
  assert.throws(() => config({ maxSlippageBps: 5000 }))
  assert.throws(() => config({ signingEnabled: true }), /keypair/)
})

test('a cycle walks buy -> finalized -> burn -> burned, and only one is open at a time', () => {
  const c = config()
  let s = recordBuy(emptyBuybackState(c), c, { cycleId: 'c1', spendLamports: '37000000', minTokenUnits: '100', signature: SIG(1), lastValidBlockHeight: 100, now: 1 })
  assert.throws(() => recordBuy(s, c, { cycleId: 'c2', spendLamports: '1', minTokenUnits: '1', signature: SIG(2), lastValidBlockHeight: 100, now: 2 }), /already open/)
  s = settleLeg(s, c, 'c1', 'buy', { finalized: true, err: null }, 50)
  assert.equal(openCycle(s)!.state, 'buy-finalized')
  s = recordBurn(s, c, 'c1', { tokenUnits: '100', signature: SIG(3), lastValidBlockHeight: 200 })
  s = settleLeg(s, c, 'c1', 'burn', { finalized: true, err: null }, 60)
  assert.equal(s.cycles[0].state, 'burned')
  assert.equal(openCycle(s), null)
})

test('an unknown outcome holds; only a passed blockhash makes "not seen" final; a failed burn re-plans', () => {
  const c = config()
  const s0 = recordBuy(emptyBuybackState(c), c, { cycleId: 'c1', spendLamports: '1', minTokenUnits: '1', signature: SIG(1), lastValidBlockHeight: 100, now: 1 })
  assert.equal(settleLeg(s0, c, 'c1', 'buy', null, 100), s0)
  assert.equal(settleLeg(s0, c, 'c1', 'buy', { finalized: false, err: null }, 500), s0)
  assert.equal(settleLeg(s0, c, 'c1', 'buy', null, 101).cycles[0].state, 'buy-expired')
  assert.equal(settleLeg(s0, c, 'c1', 'buy', { finalized: true, err: { x: 1 } }, 1).cycles[0].state, 'buy-failed')
  let s = settleLeg(s0, c, 'c1', 'buy', { finalized: true, err: null }, 1)
  s = recordBurn(s, c, 'c1', { tokenUnits: '5', signature: SIG(2), lastValidBlockHeight: 200 })
  s = settleLeg(s, c, 'c1', 'burn', { finalized: true, err: { y: 1 } }, 1)
  assert.equal(s.cycles[0].state, 'buy-finalized')
  assert.throws(() => recordBurn(s, c, 'c1', { tokenUnits: '5', signature: SIG(1), lastValidBlockHeight: 300 }), /duplicate/)
  assert.equal(closeEmpty(s, c, 'c1').cycles[0].state, 'nothing-to-burn')
})

test('the journal persists a signed cycle before the caller broadcasts, and survives reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buyback-'))
  const c = config()
  await withBuybackStore(dir, c, async (s, commit) => {
    await commit(recordBuy(s, c, { cycleId: 'c1', spendLamports: '1', minTokenUnits: '1', signature: SIG(1), lastValidBlockHeight: 100, now: 1 }))
  })
  const reopened = await withBuybackStore(dir, c, async () => {})
  assert.equal(openCycle(reopened)!.buy.signature, SIG(1))
  await assert.rejects(withBuybackStore(dir, config({ officialMint: BURN }), async () => {}), /Mint changed/)
})
