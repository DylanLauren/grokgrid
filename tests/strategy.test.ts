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

test('curve screen: user bots judge bonding-curve coins by curve-sized floors; rug checks and the house screen are unchanged', async () => {
  const { CURVE_SCREEN } = await import('../scripts/strategy-policy.mjs')
  const { agentStrategy } = await import('../scripts/agent-runner-core.mjs')
  const curve = { ...good, dexId: 'pumpfun', liquidityUsd: undefined, marketCapUsd: 40000, volume5mUsd: 1500, volume24hUsd: 8000, buys5m: 14, sells5m: 9, holders: 120, curveSol: 30, change1h: 5, pairCreatedAt: now - 45 * 60000 }
  const bot = agentStrategy(c, { maxTradeLamports: '50000000', takeProfitBasisPoints: '6000', stopLossBasisPoints: '2500' })
  assert.equal(bot.curveScreen, true); assert.equal(bot.style, 'steady') // no style picked: steady
  assert.deepEqual(screen(curve, bot, now), { ok: true, reasons: [] })
  assert.ok(!screen(curve, c, now).ok) // the house screen still wants $15k liquidity, $30k mc, 150 holders
  for (const [patch, why] of [[{ curveSol: 2 }, 'curve-sol'], [{ curveSol: undefined }, 'curve-sol'], [{ marketCapUsd: 5000 }, 'market-cap'], [{ marketCapUsd: 80000 }, 'market-cap'],
    [{ holders: 20 }, 'holders'], [{ pairCreatedAt: now - 60000 }, 'age'], [{ buys5m: 9, sells5m: 9 }, 'buy-pressure'], [{ change5m: 40 }, 'chasing-5m-pump'],
    [{ top10Share: 0.5 }, 'concentration'], [{ devShare: 0.2 }, 'dev-holding'], [{ mintAuthority: 'x' }, 'authorities'], [{ volume5mUsd: 400 }, 'volume-5m']] as const)
    assert.ok(screen({ ...curve, ...patch }, bot, now).reasons.includes(why), why)
  // a graduated (PumpSwap) coin under a bot strategy still gets the house screen
  assert.ok(screen({ ...curve, dexId: 'pumpswap' }, bot, now).reasons.includes('liquidity'))
  // a buy must stay within 1% of the curve's SOL: 0.05 SOL fits a 5 SOL curve, 0.06 doesn't
  assert.ok(screen({ ...curve, curveSol: 5 }, { ...bot, tradeLamports: '50000000' }, now).ok)
  assert.ok(screen({ ...curve, curveSol: 5 }, { ...bot, tradeLamports: '60000000' }, now).reasons.includes('trade-too-large-for-liquidity'))
  assert.equal(CURVE_SCREEN.minCurveSol, 5)
})

test('launch styles: each finds different coins with its own exits; owner TP/SL only tighten; rug checks hold for all', async () => {
  const { STYLES } = await import('../scripts/strategy-policy.mjs')
  const { agentStrategy } = await import('../scripts/agent-runner-core.mjs')
  const { whyText } = await import('../scripts/trade-why.mjs')
  const rules = (style?: string, tp = '6000', sl = '2500') => ({ maxTradeLamports: '50000000', takeProfitBasisPoints: tp, stopLossBasisPoints: sl, ...(style ? { style } : {}) })
  const base = { ...good, dexId: 'pumpfun', liquidityUsd: undefined, curveSol: 30, volume5mUsd: 2500, volume24hUsd: 9000, sells5m: 10 }
  const young = { ...base, marketCapUsd: 18000, pairCreatedAt: now - 8 * 60000, holders: 50, buys5m: 18, change5m: 10, change1h: 30 }
  const moving = { ...base, marketCapUsd: 45000, pairCreatedAt: now - 40 * 60000, holders: 90, buys5m: 20, change5m: 12, change1h: -5 }
  const calm = { ...base, marketCapUsd: 50000, pairCreatedAt: now - 120 * 60000, holders: 300, buys5m: 13, change5m: 2, change1h: 8 }
  const early = agentStrategy(c, rules('early')), momentum = agentStrategy(c, rules('momentum')), steady = agentStrategy(c, rules('steady'))
  const passes = (cfg: typeof c) => [young, moving, calm].map(m => screen(m, cfg, now).ok)
  assert.deepEqual(passes(early), [true, false, false])
  assert.deepEqual(passes(momentum), [false, true, false])
  assert.deepEqual(passes(steady), [false, false, true])
  // exits come from the style; owner values only tighten
  assert.deepEqual([early.takeProfit, early.stopLoss, early.trailArm, early.trailStop, early.maxHoldMinutes], [0.35, 0.15, 0.15, 0.12, 60])
  assert.deepEqual([momentum.takeProfit, momentum.stopLoss, momentum.maxHoldMinutes], [0.45, 0.2, 120])
  assert.equal(agentStrategy(c, rules('early', '2000', '1000')).takeProfit, 0.2)
  assert.equal(agentStrategy(c, rules('early', '2000', '1000')).stopLoss, 0.1)
  assert.equal(agentStrategy(c, rules('momentum', '9000', '5000')).stopLoss, 0.2) // looser owner value ignored
  assert.equal(agentStrategy(c, rules('nonsense')).style, 'steady')
  for (const cfg of [early, momentum, steady]) for (const [patch, why] of [[{ mintAuthority: 'x' }, 'authorities'], [{ top10Share: 0.5 }, 'concentration'], [{ devShare: 0.2 }, 'dev-holding'], [{ curveSol: 2 }, 'curve-sol'], [{ change5m: 40 }, 'chasing-5m-pump']] as const) {
    const m = cfg === early ? young : cfg === momentum ? moving : calm
    assert.ok(screen({ ...m, ...patch }, cfg, now).reasons.includes(why), `${cfg.style} ${why}`)
  }
  assert.ok(screen({ ...moving, change5m: 2 }, momentum, now).reasons.includes('not-moving'))
  assert.ok(screen({ ...calm, change1h: -1 }, steady, now).reasons.includes('hour-not-rising'))
  assert.equal(STYLES.early.screen.maxAgeMinutes, 20)
  // each style ranks by its own signal, and its why says so
  const market = (...ms: (typeof base)[]) => ({ metrics: new Map(ms.map((m, i) => [`M${i}`, { ...m, mint: `M${i}` }])), facts: new Map(ms.map((m, i) => [`M${i}`, { ...m, mint: `M${i}` }])) })
  const pol = validateTradingPolicy({ ...policy, allowedMints: 'dynamic' })
  const pick = (cfg: typeof c, mk: ReturnType<typeof market>) => livePlan({ tradingState: emptyTradingState(pol), policy: pol, c: cfg, peaks: {}, positions, market: mk, now, liquidating: false }).proposals[0]
  const younger = { ...young, pairCreatedAt: now - 4 * 60000, buys5m: 15 }
  assert.equal(pick(early, market(young, younger)).mint, 'M1') // youngest with strong buys
  const hotter = { ...moving, change5m: 20, buys5m: 30 }
  assert.equal(pick(momentum, market(moving, hotter)).mint, 'M1')
  const wider = { ...calm, holders: 900 }
  assert.equal(pick(steady, market(calm, wider)).mint, 'M1')
  assert.match(whyText(pick(early, market(young)).why, '$Y') ?? '', /^bought \$Y: early style, 8 min old, buyers outpacing sellers/)
  assert.match(whyText(pick(momentum, market(moving)).why, '$M') ?? '', /^bought \$M: momentum style, \+12% in 5m, /)
  assert.doesNotMatch(whyText(pick(momentum, market(moving)).why, '$M') ?? '', /not chasing/)
  assert.match(whyText(pick(steady, market(calm)).why, '$S') ?? '', /^bought \$S: steady style, \+8% in 1h, /)
})

test('launch rules: a style is accepted and kept; records without one keep their policy unchanged', async () => {
  const { normalizeLaunchPolicy } = await import('../scripts/runtime-launch-rules.mjs')
  const entry = { id: 'teal-cozmj', wallet: 'EDJmQM5xiiF5RDRdYfpXGzG5yi5P7Lp35eRdsyUsKYrP', mint: 'CoZmJuXuGCw8D5NfoZXmbvEPNMWC1M6ks7P95UxR5ztA', queuedAt: 1 }
  const agent = (rules: Record<string, unknown>) => ({ id: entry.id, wallet: entry.wallet, coin: { mint: entry.mint }, strategy: 'edge', rules })
  const old = normalizeLaunchPolicy(entry, agent({ maxSol: 0.05, takeProfit: 60, stopLoss: 25 }))
  assert.equal('style' in old, false)
  assert.deepEqual(Object.keys(old), ['policySchemaVersion', 'identity', 'maxTradeLamports', 'takeProfitBasisPoints', 'stopLossBasisPoints', 'strategyDescription'])
  assert.equal(normalizeLaunchPolicy(entry, agent({ maxSol: 0.05, takeProfit: 35, stopLoss: 15, style: 'early' })).style, 'early')
  assert.throws(() => normalizeLaunchPolicy(entry, agent({ maxSol: 0.05, takeProfit: 35, stopLoss: 15, style: 'yolo' })), /style/)
  assert.throws(() => normalizeLaunchPolicy(entry, agent({ maxSol: 0.05, takeProfit: 35, stopLoss: 15, extra: 1 })), /schema/)
})

test('curve candidates: DexScreener searches and GeckoTerminal pump.fun pools, curve coins only, deduped; a failed source is skipped', async () => {
  const { curveCandidates } = await import('../scripts/strategy-data.mjs')
  const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApump', B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBpump', C = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCpump'
  const fake = (async (url: string) => {
    const u = String(url)
    if (u.includes('q=pumpfun')) return { ok: true, json: async () => ({ pairs: [{ chainId: 'solana', dexId: 'pumpfun', baseToken: { address: A } }, { chainId: 'solana', dexId: 'pumpswap', baseToken: { address: C } }] }) }
    if (u.includes('q=pump%20fun')) throw Error('down')
    if (u.includes('dexes/pump-fun/pools')) return { ok: true, json: async () => ({ data: [{ relationships: { dex: { data: { id: 'pump-fun' } }, base_token: { data: { id: `solana_${B}` } } } }, { relationships: { dex: { data: { id: 'pump-fun' } }, base_token: { data: { id: `solana_${A}` } } } }] }) }
    if (u.includes('new_pools')) return { ok: true, json: async () => ({ data: [{ relationships: { dex: { data: { id: 'meteora' } }, base_token: { data: { id: `solana_${C}` } } } }] }) }
    return { ok: false, status: 500, json: async () => ({}) }
  }) as unknown as typeof fetch
  assert.deepEqual(await curveCandidates(10, fake), [A, B])
  assert.deepEqual(await curveCandidates(1, fake), [A])
})

test('steady style fits the bonding curve: 15+ minutes, 70+ holders, $25k-65k', async () => {
  const { STYLES } = await import('../scripts/strategy-policy.mjs')
  assert.deepEqual([STYLES.steady.screen.minAgeMinutes, STYLES.steady.screen.minHolders, STYLES.steady.screen.minMarketCapUsd, STYLES.steady.screen.maxMarketCapUsd], [15, 70, 25000, 65000])
})
