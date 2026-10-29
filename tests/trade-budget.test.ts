import test from 'node:test'
import assert from 'node:assert/strict'
import { tradeBudget, feesReceived24h, tierCap } from '../scripts/trade-budget.mjs'

const SOL = 1_000_000_000n, now = 1_800_000_000_000
const HARD = { capLamports: String(SOL / 2n), exposureCapLamports: String(3n * SOL / 2n), dailyLossCapLamports: String(5n * SOL / 4n) } // 0.5 / 1.5 / 1.25 absolute
const b = (o: Record<string, unknown>) => tradeBudget({ floorLamports: '1000000', ...HARD, walletLamports: '0', reserveLamports: '20000000', openCostLamports: '0', feesLamports24h: '0', ...o })

test('fee tiers: <1 SOL 0.02, >=1 0.05, >=5 0.1, >=10 0.5 (and never more)', () => {
  for (const [fees, cap] of [[0n, SOL / 50n], [SOL - 1n, SOL / 50n], [SOL, SOL / 20n], [5n * SOL - 1n, SOL / 20n], [5n * SOL, SOL / 10n], [10n * SOL - 1n, SOL / 10n], [10n * SOL, SOL / 2n], [1000n * SOL, SOL / 2n]] as const)
    assert.equal(tierCap(fees), cap, `fees ${fees}`)
})

test('no fees, small wallet: the configured 0.001 size, exactly as today', () => {
  const r = b({ walletLamports: '30000000' })
  assert.equal(r.perTradeLamports, '1000000'); assert.equal(r.reason, 'floor')
  assert.equal(r.exposureLamports, '2500000') // 25% of 0.01 spendable
  assert.equal(r.dailyLossLamports, '6000000') // 20% of 0.03 wallet
})

test('per trade follows 10% of fees or 2% of spendable, up to the tier cap', () => {
  assert.equal(b({ walletLamports: String(SOL), feesLamports24h: String(SOL / 10n) }).perTradeLamports, '19600000') // 2% of 0.98 beats 10% of 0.1
  const t1 = b({ walletLamports: String(10n * SOL), feesLamports24h: String(2n * SOL) })
  assert.equal(t1.tierCapLamports, String(SOL / 20n)); assert.equal(t1.perTradeLamports, String(SOL / 20n)); assert.equal(t1.reason, 'cap')
  const t3 = b({ walletLamports: String(100n * SOL), feesLamports24h: String(20n * SOL) })
  assert.equal(t3.perTradeLamports, String(SOL / 2n)) // top tier, absolute max
  assert.equal(t3.exposureLamports, String(3n * SOL / 2n)); assert.equal(t3.dailyLossLamports, String(5n * SOL / 4n))
})

test('never above the policy hard limits, and spendable excludes reserve and open positions', () => {
  const tight = tradeBudget({ floorLamports: '1000000', capLamports: '1000000', exposureCapLamports: '3000000', dailyLossCapLamports: '10000000', walletLamports: String(100n * SOL), reserveLamports: '20000000', openCostLamports: '0', feesLamports24h: String(20n * SOL) })
  assert.equal(tight.perTradeLamports, '1000000'); assert.equal(tight.exposureLamports, '3000000'); assert.equal(tight.dailyLossLamports, '10000000')
  const r = b({ walletLamports: String(SOL), openCostLamports: String(SOL / 2n) })
  assert.equal(r.spendableLamports, '480000000'); assert.equal(r.exposureLamports, String(3n * SOL / 50n)) // min(3 x 0.02, 25% x 0.48)
  assert.equal(b({ walletLamports: '10000000' }).spendableLamports, '0')
})

test("fees count only confirmed payouts for the bot's own coin in the last 24h, at its share", () => {
  const M = 'ANVLA6eKiAq4nstD2Sg3SZhfVkSEwfnGccn12UQWpump'
  const state = { history: [
    { mint: M, at: now - 1000, lamports: '100000000', confirmed: true },
    { mint: M, at: now - 2000, lamports: '100000000' },
    { mint: M, at: now - 3000, lamports: '100000000', confirmed: false },
    { mint: M, at: now - 90_000_000, lamports: '100000000', confirmed: true },
    { mint: 'Other', at: now - 1000, lamports: '100000000', confirmed: true },
  ] }
  assert.equal(feesReceived24h(state, [M], 8000, now), '80000000')
  assert.equal(feesReceived24h(null, [M], 8000, now), '0')
})
