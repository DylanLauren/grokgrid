import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import { DEFAULT_DISTRIBUTOR, validateDistributorConfig, coinsToDistribute, distributeGate, checkInstructions, houseCostOk, PROGRAMS } from '../scripts/fee-distributor-core.mjs'

const now = 1_800_000_000_000
const cfg = validateDistributorConfig({ ...DEFAULT_DISTRIBUTOR, enabled: true })
const GRID = 'So11111111111111111111111111111111111111112', BOT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const fee = (lamports: string, canDistribute = true) => ({ distributableFees: lamports, minimumRequired: '650240', canDistribute })

test('distributes $GRID and every bot coin once; the house row has no coin of its own', () => {
  const registry = [{ house: true, coin: { mint: '' } }, { coin: { mint: BOT } }, { coin: { mint: BOT } }, { coin: { mint: 'not-a-mint' } }]
  assert.deepEqual(coinsToDistribute(GRID, registry), [GRID, BOT])
  assert.deepEqual(coinsToDistribute(null, registry), [BOT])
})

test('sends only above the threshold and not again inside the retry window', () => {
  assert.equal(distributeGate(cfg, {}, BOT, null, now), 'no-fee-sharing')
  assert.equal(distributeGate(cfg, {}, BOT, fee('50000000', false), now), 'below-program-minimum')
  assert.equal(distributeGate(cfg, {}, BOT, fee('9999999'), now), 'below-threshold')
  assert.equal(distributeGate(cfg, {}, BOT, fee('10000000'), now), 'ok')
  assert.equal(distributeGate(cfg, { mints: { [BOT]: { at: now - 60000 } } }, BOT, fee('10000000'), now), 'recently-sent')
  assert.equal(distributeGate(cfg, { mints: { [BOT]: { at: now - 31 * 60000 } } }, BOT, fee('10000000'), now), 'ok')
})

test('only pump.fun programs, and the house may lose no more than the fee allowance', () => {
  const ix = (p: string) => ({ programId: new PublicKey(p) })
  assert.equal(checkInstructions([ix(PROGRAMS.computeBudget), ix(PROGRAMS.pump), ix(PROGRAMS.pumpFees)]), 'ok')
  assert.equal(checkInstructions([ix(PROGRAMS.pump), ix('11111111111111111111111111111111')]), 'unexpected-program') // no system transfers
  assert.equal(checkInstructions([]), 'no-instructions')
  assert.equal(houseCostOk(1_000_000, 900_000, cfg), true)
  assert.equal(houseCostOk(1_000_000, 700_000, cfg), false)
  assert.equal(houseCostOk(1_000_000, undefined as unknown as number, cfg), false)
  assert.throws(() => validateDistributorConfig({ ...DEFAULT_DISTRIBUTOR, maxFeeLamports: '5000000' }))
})
