import test from 'node:test'
import assert from 'node:assert/strict'
import { quotePrices } from '../scripts/exit-watcher-core.mjs'
import { livePlan } from '../scripts/strategy-engine.mjs'
import { DEFAULT_STRATEGY, validateStrategyConfig } from '../scripts/strategy-policy.mjs'
import { validateTradingPolicy, emptyTradingState } from '../scripts/trading-policy.mjs'

const now = 1_800_000_000_000, MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const c = validateStrategyConfig({ ...DEFAULT_STRATEGY, mode: 'live' })
const policy = validateTradingPolicy({ version: 1, mode: 'observe-only', executionEnabled: false, signingEnabled: false, agentId: 'house', wallet: 'Ho11111111111111111111111111111111111111112',
  allowedMints: 'dynamic', maxTradeLamports: '1000000', maxExposureLamports: '3000000', maxDailyLossLamports: '10000000', reserveLamports: '20000000', maxSlippageBps: 1500, maxPendingIntents: 1, maxIntentAgeMs: 60000 })
const held = [{ mint: MINT, tokenUnits: '1000000000', spendableTokenUnits: '1000000000', decimals: 6, tokenProgram: 'x' }] // 1000 tokens
const positions = { wallet: policy.wallet, complete: true, source: 'finalized-rpc-token-accounts', commitment: 'finalized', observedAt: now, contextSlots: [1, 2], positions: held }
const bought = { ...emptyTradingState(policy), intents: [{ id: 'b', agentId: 'house', wallet: policy.wallet, mint: MINT, side: 'buy', state: 'reconciled-confirmed', createdAt: now - 60000, receipt: { spentLamports: '1000000', receivedTokenUnits: '1000000000' } }] }
const entries = { [MINT]: { priceSol: 0.000001, at: now - 60000 } } // bought at 0.000001 SOL per token

const watch = (quoteLamports: string) => {
  const quotes = new Map([[MINT, quoteLamports]])
  return livePlan({ tradingState: bought, policy, c, peaks: {}, entries, positions, market: { metrics: new Map(), facts: new Map(), prices: quotePrices(held, quotes), sellQuotes: quotes }, now, liquidating: false })
}

test('an on-chain sell quote gives SOL per whole token', () => {
  assert.equal(quotePrices(held, new Map([[MINT, '750000']])).get(MINT), 0.00000075)
  assert.equal(quotePrices(held, new Map()).size, 0)
})

test('the watcher fires the strategy exits from a quote alone, sells only, and never buys', () => {
  const stop = watch('700000') // -30%: past the 25% stop
  assert.equal(stop.proposals.length, 1); assert.equal(stop.proposals[0].side, 'sell'); assert.equal(stop.proposals[0].reason, 'stop-loss')
  assert.equal(stop.proposals[0].minimumReceiveLamports, String(700000n * 8500n / 10000n)) // floor from the same quote
  assert.equal(watch('1700000').proposals[0].reason, 'take-profit') // +70%
  assert.deepEqual(watch('1050000').proposals, []) // +5%: hold
})
