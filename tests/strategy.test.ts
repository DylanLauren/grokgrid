import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_STRATEGY, validateStrategyConfig, screen, exitDecision, tighten, approve, allowed } from '../scripts/strategy-policy.mjs'
import { paperTick, emptyPaper, paperSummary, livePlan } from '../scripts/strategy-engine.mjs'
import { validateTradingPolicy, emptyTradingState, planIntent, setAllowlist } from '../scripts/trading-policy.mjs'
import { heartbeat } from '../scripts/runtime-ingest.mjs'

const now = 1_800_000_000_000
const c = validateStrategyConfig({ ...DEFAULT_STRATEGY })
const MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const good = { chainId: 'solana', mint: MINT, symbol: 'GOOD', pairCreatedAt: now - 60 * 60000, liquidityUsd: 40000, marketCapUsd: 250000, volume5mUsd: 10000, volume24hUsd: 200000,
  buys5m: 90, sells5m: 60, change5m: 8, change1h: 20, priceSol: 0.000001, solUsd: 100, mintAuthority: null, freezeAuthority: null, holders: 150, top10Share: 0.16, devShare: 0.01, decimals: 6 }
const market = (m = good) => ({ metrics: new Map([[m.mint, m]]), facts: new Map([[m.mint, { mintAuthority: m.mintAuthority, freezeAuthority: m.freezeAuthority, holders: m.holders, top10Share: m.top10Share, devShare: m.devShare }]]) })

test('a liquid coin with rising buyers passes; each failing fact is named; unknowns fail closed', () => {
  assert.deepEqual(screen(good, c, now), { ok: true, reasons: [] })
  for (const [patch, why] of [[{ mintAuthority: 'x' }, 'authorities'], [{ holders: 20 }, 'holders'], [{ top10Share: 0.6 }, 'concentration'], [{ devShare: 0.2 }, 'dev-holding'],
    [{ pairCreatedAt: now - 60000 }, 'age'], [{ buys5m: 50, sells5m: 60 }, 'buy-pressure'], [{ holders: undefined }, 'holders'], [{ liquidityUsd: 400 }, 'trade-too-large-for-liquidity'], [{ change5m: 60 }, 'chasing-5m-pump'], [{ change5m: undefined }, 'chasing-5m-pump']] as const)
    assert.ok(screen({ ...good, ...patch }, c, now).reasons.includes(why), why)
})

test('exits: take-profit, stop-loss, armed trailing stop, max hold, liquidation', () => {
  const p = { entryPriceSol: 1, peakPriceSol: 1, openedAt: now }
  assert.equal(exitDecision(p, 1.6, c, now), 'take-profit')
  assert.equal(exitDecision(p, 0.75, c, now), 'stop-loss')
  assert.equal(exitDecision({ ...p, peakPriceSol: 1.4 }, 1.11, c, now), 'trailing-stop')
  assert.equal(exitDecision({ ...p, peakPriceSol: 1.2 }, 0.96, c, now), null) // not armed below +25%
  assert.equal(exitDecision(p, 1.05, c, now + 361 * 60000), 'max-hold')
  assert.equal(exitDecision(p, 1.05, c, now, true), 'liquidate')
})

test('per-agent rules only tighten the global strategy', () => {
  const t = tighten(c, { tradeLamports: '999999999999', takeProfit: 0.3, stopLoss: 0.5, minLiquidityUsd: 1, flavor: 'degen' })
  assert.equal(t.tradeLamports, c.tradeLamports); assert.equal(t.takeProfit, 0.3); assert.equal(t.stopLoss, c.stopLoss)
  assert.equal(t.minLiquidityUsd, c.minLiquidityUsd); assert.equal(t.flavor, 'degen')
  assert.equal(tighten(c, { tradeLamports: '10000000' }).tradeLamports, '10000000')
})

test('paper loop buys a passing coin, exits on take-profit and books net PnL after fees and slippage', () => {
  let s = paperTick(emptyPaper(), c, market(), now)
  assert.equal(s.positions.length, 1); assert.equal(s.cashLamports, '950000000')
  assert.equal(paperTick(s, c, market(), now + 1000).positions.length, 1) // no double entry
  s = paperTick(s, c, market({ ...good, priceSol: 0.000002 }), now + 2000)
  assert.equal(s.closed.length, 1); assert.equal(s.closed[0].reason, 'take-profit')
  assert.ok(BigInt(s.closed[0].pnlLamports) > 0n)
  assert.equal(paperSummary(s, market()).closedTrades, 1)
})

const policy = validateTradingPolicy({ version: 1, mode: 'observe-only', executionEnabled: false, signingEnabled: false, agentId: 'house', wallet: 'So11111111111111111111111111111111111111112'.replace('So1', 'Ho1'),
  allowedMints: 'dynamic', maxTradeLamports: '50000000', maxExposureLamports: '500000000', maxDailyLossLamports: '250000000', reserveLamports: '20000000', maxSlippageBps: 1500, maxPendingIntents: 2, maxIntentAgeMs: 60000 })
const observation = { observedAt: new Date(now).toISOString(), status: 'observing', mode: 'observe-only', executionEnabled: false, signingEnabled: false, house: { wallet: policy.wallet, balanceLamports: '1000000000' } }
const risk = { wallet: policy.wallet, complete: true, exposureLamports: '0', dailyLossLamports: '0', utcDay: new Date(now).toISOString().slice(0, 10), observedAt: now }
const positions = { wallet: policy.wallet, complete: true, source: 'finalized-rpc-token-accounts', commitment: 'finalized', observedAt: now, contextSlots: [1, 2], positions: [] as unknown[] }

test('live planning writes an expiring allowlist, and planIntent buys only allowlisted mints', () => {
  const s0 = emptyTradingState(policy)
  const plan = livePlan({ tradingState: s0, policy, c, peaks: {}, positions, market: market(), now, liquidating: false })
  assert.equal(plan.proposals.length, 1); assert.equal(plan.proposals[0].side, 'buy')
  const { reason: _reason, why: _why, ...proposal } = plan.proposals[0]
  assert.throws(() => planIntent(s0, policy, proposal, observation, risk, now, positions), /Invalid or expired proposal/)
  const s1 = setAllowlist(s0, policy, plan.allowlist, now)
  assert.equal(planIntent(s1, policy, proposal, observation, risk, now, positions).intents[0].mint, MINT)
  assert.throws(() => planIntent(s1, policy, proposal, observation, risk, now + 31 * 60000, positions))
  assert.equal(livePlan({ tradingState: s0, policy, c, peaks: {}, positions, market: market(), now, liquidating: true }).proposals.length, 0)
})

test('a held position is sold on liquidation even after its allowlist entry expired', () => {
  const held = { ...positions, positions: [{ mint: MINT, tokenUnits: '5000000', spendableTokenUnits: '5000000', decimals: 6, tokenProgram: 'x' }] }
  const quoted = (q?: string) => ({ ...market(), sellQuotes: new Map(q ? [[MINT, q]] : []) })
  assert.equal(livePlan({ tradingState: emptyTradingState(policy), policy, c, peaks: {}, positions: held, market: quoted(), now, liquidating: true }).proposals.length, 0) // no on-chain quote, no sell
  assert.equal(livePlan({ tradingState: emptyTradingState(policy), policy, c, peaks: {}, positions: held, market: quoted('2000'), now, liquidating: true }).proposals.length, 0) // DexScreener disagrees >15%
  const plan = livePlan({ tradingState: emptyTradingState(policy), policy, c, peaks: {}, positions: held, market: quoted('5000'), now, liquidating: true })
  assert.equal(plan.proposals[0].side, 'sell'); assert.equal(plan.proposals[0].reason, 'liquidate')
  assert.equal(plan.proposals[0].minimumReceiveLamports, String(5000n * 8500n / 10000n))
  const { reason: _reason, why: _why, ...proposal } = plan.proposals[0]
  assert.equal(planIntent(emptyTradingState(policy), policy, proposal, observation, null, now, held).intents[0].side, 'sell')
})

test('allowlist entries expire; heartbeat refuses unknown workers and sends nothing when ingest is off', async () => {
  const list = approve([], MINT, c, now, {})
  assert.ok(allowed(list, MINT, now + 29 * 60000)); assert.ok(!allowed(list, MINT, now + 31 * 60000))
  let called = false
  assert.equal(await heartbeat('/nonexistent', 'nope', { mode: 'paper', healthy: true }, async () => { called = true; return { ok: true } as Response }), false)
  process.env.GROKGRID_INGEST = 'off'
  assert.equal(await heartbeat('/nonexistent', 'strategy', { mode: 'paper', healthy: true }, async () => { called = true; return { ok: true } as Response }), false)
  assert.equal(called, false)
})

test('callouts post each reconciled trade once; site rejections are not retried; outages are', async () => {
  const { pendingCallouts } = await import('../scripts/trading-callouts.mjs')
  const sig = (n: number) => '5'.repeat(87) + n
  const state = { intents: [
    { state: 'reconciled-confirmed', signature: sig(1), side: 'buy', mint: MINT, receipt: { spentLamports: '50000000' } },
    { state: 'held-ambiguous', signature: sig(2), side: 'buy', mint: MINT },
    { state: 'reconciled-confirmed', signature: sig(3), side: 'sell', mint: MINT, receipt: { receivedLamports: '70000000' } } ] }
  assert.deepEqual(pendingCallouts(state, { posted: {} }).map((i: { signature: string }) => i.signature), [sig(1), sig(3)])
  assert.deepEqual(pendingCallouts(state, { posted: { [sig(1)]: { outcome: 'posted' }, [sig(3)]: { outcome: 'rejected-422' } } }), [])
})

test('phone heartbeat is healthy only while frames are fresh', async () => {
  const { phoneBeat } = await import('../scripts/runtime-ingest.mjs')
  const now = Date.parse('2026-10-29T03:00:00Z')
  assert.equal(phoneBeat({ state: 'sending', lastSentAt: '2026-10-29T02:59:30Z' }, now).healthy, true)
  assert.equal(phoneBeat({ state: 'sending', lastSentAt: '2026-10-29T02:58:30Z' }, now).healthy, false)
  assert.equal(phoneBeat({ state: 'waiting-for-window', lastSentAt: '2026-10-29T02:59:59Z' }, now).note, 'waiting-for-window')
  assert.equal(phoneBeat(null, now).healthy, false)
})

test('a coin that was just stopped out is not bought again inside the cooldown', () => {
  let s = paperTick(emptyPaper(), c, market(), now)
  s = paperTick(s, c, market({ ...good, priceSol: 0.0000005 }), now + 60000) // -50%: stop-loss
  assert.equal(s.closed[0].reason, 'stop-loss'); assert.equal(s.positions.length, 0)
  assert.equal(paperTick(s, c, market(), now + 120000).positions.length, 0)
  assert.equal(paperTick(s, c, market(), now + 60000 + c.reentryCooldownMinutes * 60000 + 1).positions.length, 1)
})

test('live exits measure from the decision price, not a first-buy cost inflated by account rent', () => {
  const held = { ...positions, positions: [{ mint: MINT, tokenUnits: '5000000', spendableTokenUnits: '5000000', decimals: 6, tokenProgram: 'x' }] }
  // 5 tokens at 0.000001 SOL cost 5000 lamports; the wallet paid 12500 because of one-time rent.
  const s = { ...emptyTradingState(policy), intents: [{ id: 'buy-1', agentId: 'house', wallet: policy.wallet, mint: MINT, side: 'buy', state: 'reconciled-confirmed', createdAt: now - 60000, receipt: { spentLamports: '12500', receivedTokenUnits: '5000000' } }] }
  const m = { ...market(), sellQuotes: new Map([[MINT, '5000']]) }
  const args = { tradingState: s, policy, c, peaks: {}, positions: held, market: m, now, liquidating: false }
  assert.equal(livePlan(args).proposals[0]?.reason, 'stop-loss') // rent read as a 60% loss
  const plan = livePlan({ ...args, entries: { [MINT]: { priceSol: 0.000001, at: now - 60000 } } })
  assert.equal(plan.proposals.length, 0); assert.ok(plan.entries[MINT])
  const buy = livePlan({ ...args, positions, tradingState: emptyTradingState(policy), market: market() })
  assert.equal(buy.entries[MINT].priceSol, good.priceSol) // a new buy records its decision price
  assert.deepEqual(livePlan({ ...args, positions, tradingState: emptyTradingState(policy), market: { metrics: new Map(), facts: new Map() }, entries: { [MINT]: { priceSol: 1, at: now - 11 * 60000 } } }).entries, {})
})

test('never plans a second buy of a coin just bought, held, or with a pending intent', () => {
  const buy = (state: string, at = now - 60000) => ({ id: `buy-${state}`, agentId: 'house', wallet: policy.wallet, mint: MINT, side: 'buy', state, createdAt: at, spendLamports: '1000000', receipt: { spentLamports: '1000000', receivedTokenUnits: '1000000' } })
  const plan = (intents: unknown[], pos = positions) => livePlan({ tradingState: { ...emptyTradingState(policy), intents }, policy, c, peaks: {}, positions: pos, market: market(), now, liquidating: false })
  assert.equal(plan([]).proposals.filter(p => p.side === 'buy').length, 1)
  assert.equal(plan([buy('reconciled-confirmed')]).proposals.length, 0) // snapshot has not caught up yet
  assert.equal(plan([buy('held-ambiguous')]).proposals.length, 0)
  assert.equal(plan([buy('planned')]).proposals.length, 0)
  const held = { ...positions, positions: [{ mint: MINT, tokenUnits: '5', spendableTokenUnits: '0', decimals: 6, tokenProgram: 'x' }] }
  assert.equal(plan([], held).proposals.length, 0)
  const sold = { id: 'sell-1', agentId: 'house', wallet: policy.wallet, mint: MINT, side: 'sell', state: 'reconciled-confirmed', createdAt: now - 30000, receipt: { soldTokenUnits: '1000000', receivedLamports: '900000' } }
  assert.equal(plan([buy('reconciled-confirmed'), sold]).proposals.length, 0) // sold, but inside the re-entry cooldown
  assert.equal(livePlan({ tradingState: { ...emptyTradingState(policy), intents: [buy('reconciled-confirmed', now - 999 * 60000), { ...sold, createdAt: now - 998 * 60000 }] }, policy, c, peaks: {}, positions, market: market(), now, liquidating: false }).proposals.filter(p => p.side === 'buy').length, 1)
})

test('live buys use the fee/balance budget and stop at its exposure limit', () => {
  const small = validateStrategyConfig({ ...c, tradeLamports: '1000000' })
  const plan = (sizing: Record<string, string> | null, intents: unknown[] = []) => livePlan({ tradingState: { ...emptyTradingState(policy), intents }, policy, c: small, peaks: {}, positions, market: market(), now, liquidating: false, sizing })
  assert.equal(plan(null).proposals[0].spendLamports, '1000000') // no sizing inputs: configured size
  assert.equal(plan({ walletLamports: '1000000000', feesLamports24h: '0' }).proposals[0].spendLamports, '19600000') // 2% of 0.98 spendable
  const rich = plan({ walletLamports: '5000000000', feesLamports24h: '0' })
  assert.equal(rich.proposals[0].spendLamports, '20000000') // clamped to the no-fees tier cap (0.02), below the policy's 0.05
  assert.equal(rich.budget.reason, 'cap')
  const open = { id: 'b', agentId: 'house', wallet: policy.wallet, mint: 'So11111111111111111111111111111111111111112', side: 'buy', state: 'reconciled-confirmed', createdAt: now - 1000, receipt: { spentLamports: '480000000', receivedTokenUnits: '1' } }
  assert.equal(plan({ walletLamports: '1000000000', feesLamports24h: '0' }, [open]).proposals.filter(p => p.side === 'buy').length, 0) // 0.48 open > 25% of what is left: no room
})
