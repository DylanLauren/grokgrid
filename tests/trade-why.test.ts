import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buyWhy, sellWhy, whyText, recordWhys, readWhys } from '../scripts/trade-why.mjs'
import { thesis } from '../scripts/pump-callouts.mjs'
import { livePlan } from '../scripts/strategy-engine.mjs'
import { DEFAULT_STRATEGY, validateStrategyConfig } from '../scripts/strategy-policy.mjs'
import { validateTradingPolicy, emptyTradingState } from '../scripts/trading-policy.mjs'

const now = 1_800_000_000_000
const MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const good = { chainId: 'solana', mint: MINT, symbol: 'GOOD', pairCreatedAt: now - 60 * 60000, liquidityUsd: 48000, marketCapUsd: 250000, volume5mUsd: 10000, volume24hUsd: 200000,
  buys5m: 84, sells5m: 40, change5m: 8, priceSol: 0.000001, solUsd: 100, mintAuthority: null, freezeAuthority: null, holders: 410, top10Share: 0.18, devShare: 0.01 }

test('a buy explains itself from the numbers it passed the screen on', () => {
  const w = buyWhy(good, now)
  assert.deepEqual([w.ratio, w.holders, w.ageMin, w.top10Share], [2.1, 410, 60, 0.18])
  assert.equal(whyText(w, '$GOOD'), 'bought $GOOD: buyers outpacing sellers 2.1× (84 buys in 5m), $48k liquidity, 410 holders, top 10 hold 18%. $250k mc, +8% in 5m, not chasing.')
})

test('a sell names the exit rule and the move that fired it', () => {
  const p = { entryPriceSol: 1, peakPriceSol: 1.5, openedAt: now - 42 * 60000 }
  assert.equal(whyText(sellWhy('take-profit', p, 1.62, now), '$GOOD'), 'sold $GOOD: took profit at +62% after 42m.')
  assert.equal(whyText(sellWhy('stop-loss', p, 0.74, now), '$GOOD'), 'sold $GOOD: stop-loss at -26% after 42m, cutting it early.')
  assert.equal(whyText(sellWhy('trailing-stop', p, 1.2, now), '$GOOD'), 'sold $GOOD: trailing stop, peaked +50%, out at +20% after 42m.')
  assert.equal(whyText(sellWhy('liquidate', undefined, 1, now), '$GOOD'), 'sold $GOOD: winding down positions.')
  assert.equal(whyText(sellWhy('max-hold', p, 1.05, now + 318 * 60000), 'it'), 'sold it: max hold time reached at +5% after 6h.')
  assert.equal(whyText(null), null); assert.equal(whyText({ kind: 'sell', reason: 'other' }), null)
})

test('live proposals carry their why', () => {
  const c = validateStrategyConfig({ ...DEFAULT_STRATEGY })
  const policy = validateTradingPolicy({ version: 1, mode: 'observe-only', executionEnabled: false, signingEnabled: false, agentId: 'house', wallet: 'Ho11111111111111111111111111111111111111112',
    allowedMints: 'dynamic', maxTradeLamports: '50000000', maxExposureLamports: '500000000', maxDailyLossLamports: '250000000', reserveLamports: '20000000', maxSlippageBps: 1500, maxPendingIntents: 2, maxIntentAgeMs: 60000 })
  const positions = { wallet: policy.wallet, complete: true, positions: [] }
  const market = { metrics: new Map([[MINT, good]]), facts: new Map([[MINT, good]]) }
  const [buy] = livePlan({ tradingState: emptyTradingState(policy), policy, c, peaks: {}, positions, market, now, liquidating: false }).proposals
  assert.equal(buy.why.kind, 'buy'); assert.equal(buy.why.holders, 410)
})

test('whys are kept per writer by intent id and merged on read', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'why-'))); await chmod(dir, 0o700)
  await recordWhys(join(dir, 'trade-why-strategy.json'), { 'buy-1': buyWhy(good, now) }, now)
  await recordWhys(join(dir, 'trade-why-exit.json'), { 'sell-1': sellWhy('take-profit', { entryPriceSol: 1 }, 1.7, now), 'sell-2': undefined }, now)
  await recordWhys(join(dir, 'trade-why-strategy.json'), { 'buy-2': buyWhy(good, now) }, now + 1)
  const all = await readWhys(dir)
  assert.deepEqual([...all.keys()].sort(), ['buy-1', 'buy-2', 'sell-1'])
  assert.equal((await readWhys(join(dir, 'missing'))).size, 0)
})

test('the pump.fun thesis uses the why and stays within 280 characters', () => {
  const intent = { receipt: { spentLamports: '20000000' } }
  const t = thesis(intent, 'GOOD', buyWhy(good, now))
  assert.match(t, /^Grok Bot bought 0\.020 SOL of \$GOOD on its own\. Why: buyers outpacing sellers 2\.1×/)
  assert.ok(t.length <= 280)
  assert.match(thesis(intent, 'GOOD'), /Screened for liquidity/)
})
