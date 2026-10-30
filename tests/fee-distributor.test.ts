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

test('lifetime fees: payouts are read from the event in logs or self-CPI, once each, for this coin only', async () => {
  const { parseDistributeEvent, distributedIn, lifetimeFeesSol } = await import('../scripts/fee-distributor-core.mjs')
  const { PublicKey } = await import('@solana/web3.js')
  const bs58 = (await import('bs58')).default
  const mint = new PublicKey('CoZmJuXuGCw8D5NfoZXmbvEPNMWC1M6ks7P95UxR5ztA'), other = new PublicKey('7vC3gpv9YvSMtEc5QmyQbFLSqnEy7QKK2ETyrjXRTWob')
  const event = (m: InstanceType<typeof PublicKey>, lamports: bigint, holders = 2) => {
    const head = Buffer.alloc(8 + 8 + 32 * 5 + 4 + holders * 34 + 8 + 32)
    Buffer.from([165, 55, 129, 112, 4, 179, 202, 40]).copy(head, 0)
    m.toBuffer().copy(head, 16)
    head.writeUInt32LE(holders, 144)
    head.writeBigUInt64LE(lamports, 148 + holders * 34)
    return head
  }
  assert.equal(parseDistributeEvent(event(mint, 5_000_000n))?.distributed, 5_000_000n)
  assert.equal(parseDistributeEvent(event(mint, 5_000_000n))?.mint, mint.toBase58())
  assert.equal(parseDistributeEvent(Buffer.alloc(40)), null)
  const tag = Buffer.from('e445a52e51cb9a1d', 'hex')
  const tx = { meta: { err: null,
    logMessages: ['Program log: x', `Program data: ${event(mint, 7_000_000n).toString('base64')}`, `Program data: ${event(other, 9n).toString('base64')}`],
    innerInstructions: [{ instructions: [{ data: bs58.encode(Buffer.concat([tag, event(mint, 7_000_000n)])) }, { data: bs58.encode(Buffer.concat([tag, event(mint, 3_000_000n)])) }] }] } }
  assert.equal(distributedIn(tx, mint.toBase58(), (d: string) => bs58.decode(d)), 10_000_000n) // 7M seen twice counts once, plus 3M
  assert.equal(distributedIn({ meta: { ...tx.meta, err: { x: 1 } } }, mint.toBase58(), (d: string) => bs58.decode(d)), 0n)
  assert.equal(lifetimeFeesSol('10000000', '2500000'), 0.0125)
  assert.equal(lifetimeFeesSol('10000000', null), null)
})
