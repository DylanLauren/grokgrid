import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PublicKey, TransactionMessage, VersionedTransaction, TransactionInstruction } from '@solana/web3.js'
import { authorizedLaunch } from '../api/_verify'

process.env.KV_REST_API_URL = 'https://redis.invalid'
process.env.KV_REST_API_TOKEN = 'test-only'
const { freeWallets, pinWallet, releaseWallet } = await import('../api/_launch')
const a = '11111111111111111111111111111111'
const b = 'So11111111111111111111111111111111111111112'

test('availability excludes wallets already leased by another visitor', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => Response.json(++calls === 1 ? [{ result: [a, b] }] : [{ result: 1 }, { result: 0 }])
  try { assert.equal(await freeWallets(), 1) } finally { globalThis.fetch = original }
})

test('a rejected atomic lease claim cannot authorize a send', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const [command] = JSON.parse(options!.body as string)
    assert.equal(command[0], 'EVAL')
    assert.ok(command.includes('old-mint'))
    assert.ok(command.includes('expected-record'))
    return Response.json([{ result: 0 }])
  }
  try { assert.equal(await pinWallet(a, 'old-mint', 'expected-record', 'recovery'), false) } finally { globalThis.fetch = original }
})

test('lease cleanup uses atomic ownership comparison rather than unconditional deletion', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const commands = JSON.parse(options!.body as string)
    assert.equal(commands.length, 1)
    assert.equal(commands[0][0], 'EVAL')
    assert.equal(commands[0].at(-1), 'expired-mint')
    return Response.json([{ result: 0 }])
  }
  try { await releaseWallet(a, 'expired-mint') } finally { globalThis.fetch = original }
})

test('nonzero forged signatures cannot pin a trading wallet', () => {
  // Synthetic, unsigned instruction. No real wallet keys or network calls.
  const message = new TransactionMessage({ payerKey: new PublicKey(a), recentBlockhash: a, instructions: [
    new TransactionInstruction({ programId: new PublicKey(b), keys: [{ pubkey: new PublicKey(b), isSigner: true, isWritable: false }], data: Buffer.alloc(0) }),
  ] }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  tx.signatures = [new Uint8Array(64).fill(1), new Uint8Array(64).fill(1)]
  assert.throws(() => authorizedLaunch(Buffer.from(tx.serialize()).toString('base64'), Buffer.from(message.serialize()).toString('base64')), /valid signature/)
})
