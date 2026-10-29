import test from 'node:test'
import assert from 'node:assert/strict'
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction, PublicKey } from '@solana/web3.js'
import { validateRunnerConfig, agentTradingPolicy, agentStrategy, privySigner, mapLimit, outboxHealth } from '../scripts/agent-runner-core.mjs'
import { DEFAULT_STRATEGY, validateStrategyConfig } from '../scripts/strategy-policy.mjs'

const config = (over: Record<string, unknown> = {}) => validateRunnerConfig({ version: 1, mode: 'execute', stopFile: '/s', exitFile: '/e', privyServerFile: '/p', privyAuthorizationKeyFile: '/k', maxAgents: 50,
  caps: { maxTradeLamports: '50000000', maxExposureLamports: '500000000', maxDailyLossLamports: '250000000', reserveLamports: '20000000', maxSlippageBps: 1500 }, ...over })
const owner = Keypair.generate()
const agent = { id: 'bot-1', wallet: owner.publicKey.toBase58(), privyWalletId: 'wallet_abc', maxTradeLamports: '9000000000', takeProfitBasisPoints: '5000', stopLossBasisPoints: '9000' }

test('agent caps never exceed global caps; no Privy wallet id means observe-only', () => {
  const p = agentTradingPolicy(config(), agent)
  assert.equal(p.mode, 'execute'); assert.equal(p.maxTradeLamports, '50000000'); assert.equal(p.allowedMints, 'dynamic')
  assert.equal(agentTradingPolicy(config(), { ...agent, maxTradeLamports: '10000000' }).maxTradeLamports, '10000000')
  assert.equal(agentTradingPolicy(config(), { ...agent, privyWalletId: undefined }).mode, 'observe-only')
  assert.equal(agentTradingPolicy(config(), { ...agent, privyWalletId: 'did:privy:wallet_1' }).mode, 'execute')
  assert.equal(agentTradingPolicy(config(), { ...agent, privyWalletId: 'bad id' }).mode, 'observe-only')
  assert.equal(agentTradingPolicy(config({ mode: 'paper', privyServerFile: undefined, privyAuthorizationKeyFile: undefined }), agent).mode, 'observe-only')
  assert.throws(() => config({ privyAuthorizationKeyFile: 'relative' }))
})

test('owner take-profit can tighten the strategy; a looser stop-loss cannot', () => {
  const s = agentStrategy(validateStrategyConfig({ ...DEFAULT_STRATEGY }), agent)
  assert.equal(s.takeProfit, 0.5); assert.equal(s.stopLoss, DEFAULT_STRATEGY.stopLoss); assert.equal(s.tradeLamports, DEFAULT_STRATEGY.tradeLamports)
})

const tx = (payer: PublicKey) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111',
  instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message())

test('Privy signer: agent-paid only, sends the authorization key and an idempotency key, rejects a changed message', async () => {
  let seen: Record<string, unknown> = {}
  const honest = { solana: () => ({ signTransaction: async (id: string, input: Record<string, unknown>) => {
    seen = { id, ...input }; const t = VersionedTransaction.deserialize(Buffer.from(String(input.transaction), 'base64')); t.sign([owner])
    return { signed_transaction: Buffer.from(t.serialize()).toString('base64'), encoding: 'base64' } } }) }
  const signed = await privySigner({ wallets: honest, walletId: 'wallet_abc', address: agent.wallet, authorizationKey: 'k' })(tx(owner.publicKey))
  assert.ok(signed.signatures[0].some((b: number) => b !== 0))
  assert.equal(seen.id, 'wallet_abc'); assert.deepEqual(seen.authorization_context, { authorization_private_keys: ['k'] }); assert.match(String(seen.idempotency_key), /^[a-f0-9]{64}$/)
  await assert.rejects(privySigner({ wallets: honest, walletId: 'w', address: agent.wallet, authorizationKey: 'k' })(tx(Keypair.generate().publicKey)), /paid by the agent/)
  const swapper = { solana: () => ({ signTransaction: async () => ({ signed_transaction: Buffer.from(tx(owner.publicKey).serialize()).toString('base64') }) }) }
  await assert.rejects(privySigner({ wallets: swapper, walletId: 'w', address: agent.wallet, authorizationKey: 'k' })(tx(owner.publicKey)), /changed the transaction/)
})

test('agents run a bounded few at a time, keep their order, and one failure does not stop the rest', async () => {
  let inFlight = 0, peak = 0
  const out = await mapLimit([...Array(20).keys()], 6, async n => {
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise(r => setTimeout(r, 5 + (n % 3)))
    inFlight--
    try { if (n === 7) throw Error('agent 7 broke'); return n * 2 } catch { return 'error' }
  })
  assert.equal(peak, 6)
  assert.equal(out[7], 'error'); assert.equal(out[19], 38); assert.equal(out.length, 20)
  assert.deepEqual(await mapLimit([], 6, async () => 1), [])
  const base = { version: 1, mode: 'paper', stopFile: '/s', exitFile: '/e', maxAgents: 100, caps: { maxTradeLamports: '1', maxExposureLamports: '1', maxDailyLossLamports: '1', reserveLamports: '1', maxSlippageBps: 100 } }
  assert.equal(validateRunnerConfig({ ...base, concurrency: 8 }).concurrency, 8)
  assert.throws(() => validateRunnerConfig({ ...base, concurrency: 64 }), /concurrency/)
})

test('a slow launch outbox is tolerated for a few ticks, then reported down; success resets it', () => {
  let failures: number | undefined
  const seen: boolean[] = []
  for (let i = 0; i < 5; i++) { const o = outboxHealth(failures, true); failures = o.failures; seen.push(o.healthy) }
  assert.deepEqual(seen, [true, true, true, false, false])
  assert.deepEqual(outboxHealth(failures, false), { failures: 0, healthy: true })
  assert.deepEqual(outboxHealth(-3, true), { failures: 1, healthy: true }) // a corrupt count starts over
})
