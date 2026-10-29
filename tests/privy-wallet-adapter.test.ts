import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { privyWalletAdapter } from '../src/data/privyWalletAdapter.ts'
const address = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const tx = (blockhash = '11111111111111111111111111111111') => new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(address), recentBlockhash: blockhash, instructions: [] }).compileToV0Message())
test('setup never calls signing; only supported exact-payer transactions reach adapter', async () => {
  let calls = 0
  const adapter = privyWalletAdapter(address, () => true, async bytes => { calls++; return bytes })
  await adapter.connect()
  assert.equal(calls, 0)
  await assert.rejects(adapter.signTransaction!({}), /Unexpected/)
  const other = privyWalletAdapter('11111111111111111111111111111111', () => true, async bytes => { calls++; return bytes })
  await assert.rejects(other.signTransaction!(tx()), /Unexpected/)
  assert.equal(calls, 0)
  await adapter.signTransaction!(tx()) // Test byte echo only: no key or real signature exists.
  assert.equal(calls, 1)
})
test('account changes during approval and changed returned message are rejected', async () => {
  let current = true
  const adapter = privyWalletAdapter(address, () => current, async bytes => { current = false; return bytes })
  await assert.rejects(adapter.signTransaction!(tx()), /wallet changed/)
  await assert.rejects(adapter.connect(), /wallet changed/)
  const changed = privyWalletAdapter(address, () => true, async () => tx(address).serialize())
  await assert.rejects(changed.signTransaction!(tx()), /changed the launch transaction/)
})
