import test from 'node:test'
import assert from 'node:assert/strict'
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js'
import { onlyFunding } from '../src/data/launch.ts'
import { routable } from '../api/_finish.ts'

const owner = Keypair.generate().publicKey, bot = Keypair.generate().publicKey, other = Keypair.generate().publicKey
const tx = (...ixs: Parameters<TransactionMessage['instructions']['push']>) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: '11111111111111111111111111111111', instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), ...ixs] }).compileToV0Message())

test('a launch may only carry the one transfer that funds this bot', () => {
  const fund = (to = bot, lamports = 50_000_000) => SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports })
  assert.equal(onlyFunding(tx(fund()), owner.toBase58(), bot.toBase58(), 50_000_000n), true)
  assert.equal(onlyFunding(tx(fund(other)), owner.toBase58(), bot.toBase58(), 50_000_000n), false)
  assert.equal(onlyFunding(tx(fund(bot, 60_000_000)), owner.toBase58(), bot.toBase58(), 50_000_000n), false)
  assert.equal(onlyFunding(tx(fund(), fund()), owner.toBase58(), bot.toBase58(), 50_000_000n), false)
  assert.equal(onlyFunding(tx(), owner.toBase58(), owner.toBase58(), 0n), true)
  assert.equal(onlyFunding(tx(fund()), owner.toBase58(), owner.toBase58(), 0n), false)
})

test('launch records route as v2 (same wallet) or v3 (owner funds a separate bot wallet)', () => {
  assert.equal(routable({ routingVersion: 2, bot: 'A', launcher: 'A' }), true)
  assert.equal(routable({ routingVersion: 2, bot: 'B', launcher: 'A' }), false)
  assert.equal(routable({ routingVersion: 3, bot: 'B', launcher: 'A' }), true)
  assert.equal(routable({ routingVersion: 3, bot: 'A', launcher: 'A' }), false)
  assert.equal(routable({ bot: 'A', launcher: 'A' }), false)
})
