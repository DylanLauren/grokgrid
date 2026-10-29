import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTradingPolicy, emptyTradingState, planIntent, dropExpiredSubmission, reconcileHeldIntent, validateTradingState } from '../scripts/trading-policy.mjs'
import { journalRisk, nextExecutable, signNext } from '../scripts/trading-executor.mjs'

const wallet = 'So11111111111111111111111111111111111111112'.replace('So1', 'Ho1')
const mint = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const now = 1_800_000_000_000
const SIG = '5'.repeat(88)
const execute = (over: Record<string, unknown> = {}) => validateTradingPolicy({
  version: 1, mode: 'execute', executionEnabled: true, signingEnabled: true, stopFile: '/tmp/STOP', keypairFile: '/tmp/house.json',
  agentId: 'house', wallet, allowedMints: [mint], maxTradeLamports: '50000000', maxExposureLamports: '500000000',
  maxDailyLossLamports: '250000000', reserveLamports: '20000000', maxSlippageBps: 1500, maxPendingIntents: 1, maxIntentAgeMs: 60000, ...over,
})
const observation = { observedAt: new Date(now).toISOString(), status: 'observing', mode: 'observe-only', executionEnabled: false, signingEnabled: false, house: { wallet, balanceLamports: '1000000000' } }
const proposal = { id: 'buy1', agentId: 'house', wallet, mint, side: 'buy', spendLamports: '50000000', slippageBps: 1500, createdAt: now, expiresAt: now + 60000 }
const planned = (p = execute()) => planIntent(emptyTradingState(p), p, proposal, observation, journalRisk(emptyTradingState(p), wallet, now), now)
const deps = (over: Record<string, unknown> = {}) => ({ stopFilePresent: false, build: async () => ({ tx: { id: 'tx' }, lastValidBlockHeight: 900 }), sign: () => {}, signatureOf: () => SIG, ...over })

test('execute mode needs both flags, a stop file and a key file; observe mode cannot claim either flag', () => {
  assert.throws(() => execute({ signingEnabled: false }))
  assert.throws(() => execute({ stopFile: undefined }))
  assert.throws(() => execute({ keypairFile: 'relative.json' }))
  assert.throws(() => validateTradingPolicy({ ...execute(), mode: 'observe-only' }))
  assert.throws(() => execute({ maxSlippageBps: 2500 }))
})

test('a planned buy is signed, journaled held with its blockhash and cost ceiling, and blocks the next', async () => {
  const p = execute(), s = planned(p)
  assert.equal(s.intents[0].state, 'planned')
  const r = await signNext(s, p, deps(), now)
  assert.equal(r.reason, 'signed')
  const held = r.state.intents[0]
  assert.equal(held.state, 'held-ambiguous'); assert.equal(held.signature, SIG); assert.equal(held.lastValidBlockHeight, 900)
  assert.equal(held.maxCostLamports, String(50_000_000n + 2_100_000n))
  assert.equal(nextExecutable(r.state, p, now, false).reason, 'submission-unresolved')
})

test('the stop file, observe mode and a near-expiry intent never sign', async () => {
  const p = execute(), s = planned(p)
  let signed = false
  for (const [state, policy, stop, at] of [[s, p, true, now], [s, p, undefined, now], [s, p, false, now + 56000]] as const) {
    const r = await signNext(state, policy, deps({ stopFilePresent: stop, sign: () => { signed = true } }), at)
    assert.equal(r.tx, null)
  }
  assert.equal(signed, false)
  const observe = { ...p, mode: 'observe-only', executionEnabled: false, signingEnabled: false, stopFile: undefined, keypairFile: undefined }
  assert.equal(nextExecutable(emptyTradingState(observe), observe, now, false).reason, 'observe-only')
})

test('a dropped blockhash releases the hold only when the signature was never seen', async () => {
  const p = execute(), held = (await signNext(planned(p), p, deps(), now)).state
  assert.equal(dropExpiredSubmission(held, p, 'buy1', null, 900), held)
  assert.equal(dropExpiredSubmission(held, p, 'buy1', { finalized: false, err: null }, 5000), held)
  const dropped = dropExpiredSubmission(held, p, 'buy1', null, 901)
  assert.equal(dropped.intents[0].state, 'dropped-expired')
  assert.equal(nextExecutable(dropped, p, now, false).reason, 'nothing-planned')
})

test('an executed buy reconciles at or under its ceiling, and feeds conservative risk', async () => {
  const p = execute(), held = (await signNext(planned(p), p, deps(), now)).state
  const receipt = (spent: string) => async () => ({ signature: SIG, wallet, mint, finality: 'finalized', slot: 10, outcome: 'confirmed', spentLamports: spent, receivedTokenUnits: '123' })
  assert.equal((await reconcileHeldIntent(held, p, 'buy1', receipt('52100001'))).intents[0].state, 'held-ambiguous')
  const done = await reconcileHeldIntent(held, p, 'buy1', receipt('51000000'))
  assert.equal(done.intents[0].state, 'reconciled-confirmed')
  validateTradingState(done, p)
  const risk = journalRisk(done, wallet, now)
  assert.equal(risk.exposureLamports, '51000000'); assert.equal(risk.dailyLossLamports, '51000000')
  assert.equal(journalRisk(done, wallet, now + 86_400_000).dailyLossLamports, '0')
})

test('daily loss and exposure limits stop signing', async () => {
  const p = execute({ maxDailyLossLamports: '50000000' }), held = (await signNext(planned(p), p, deps(), now)).state
  const done = await reconcileHeldIntent(held, p, 'buy1', async () => ({ signature: SIG, wallet, mint, finality: 'finalized', slot: 10, outcome: 'confirmed', spentLamports: '50000000', receivedTokenUnits: '1' }))
  const again = planIntent(done, { ...p, maxDailyLossLamports: '50000000' }, { ...proposal, id: 'buy2' }, observation, { ...journalRisk(done, wallet, now), dailyLossLamports: '0' }, now)
  assert.equal(nextExecutable(again, p, now, false).reason, 'daily-loss-stop')
})

test('the chain receipt reader accepts an executed buy under its ceiling and rejects one over it', async () => {
  const { inspectFinalizedIntentReceipt } = await import('../scripts/trading-reconcile.mjs')
  const intent = { signature: SIG, wallet, mint, side: 'buy', spendLamports: '100', maxCostLamports: '150', createdAt: now, expiresAt: now + 60000 }
  const tx = (spent: number) => ({ slot: 5, blockTime: Math.floor(now / 1000) + 1, transaction: { signatures: [SIG], message: { accountKeys: [{ pubkey: wallet, signer: true }, { pubkey: mint, signer: false }] } },
    meta: { err: null, fee: 0, preBalances: [1000, 0], postBalances: [1000 - spent, 0],
      preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint, owner: wallet, uiTokenAmount: { amount: '7', decimals: 6 } }] } })
  const status = { confirmationStatus: 'finalized', slot: 5, err: null }
  assert.equal(inspectFinalizedIntentReceipt(intent, status, tx(120))?.spentLamports, '120')
  assert.equal(inspectFinalizedIntentReceipt(intent, status, tx(151)), null)
  assert.equal(inspectFinalizedIntentReceipt({ ...intent, maxCostLamports: undefined }, status, tx(120)), null)
})
