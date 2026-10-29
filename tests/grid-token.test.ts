import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burnedTokens, readMint } from '../api/_token'

const mint = (info: Record<string, unknown>, owner = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') => ({ owner, data: { parsed: { type: 'mint', info } } })

test('burns are whatever is missing from the one billion start supply', () => {
  const m = readMint(mint({ supply: '999000000000000', decimals: 6, mintAuthority: null, freezeAuthority: null }))
  assert.ok(m)
  assert.equal(burnedTokens(m), 1_000_000)
  assert.equal(burnedTokens({ ...m, supply: '1000000000000000' }), 0)
})

test('a supply above one billion is not a pump.fun coin and reports no burns', () => {
  const m = readMint(mint({ supply: '1000000000000001', decimals: 6, mintAuthority: null, freezeAuthority: null }))
  assert.ok(m)
  assert.equal(burnedTokens(m), null)
})

test('anything that is not an SPL mint is refused', () => {
  assert.equal(readMint(null), null)
  assert.equal(readMint(mint({ supply: '1', decimals: 6 }, '11111111111111111111111111111111')), null)
  assert.equal(readMint({ owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { type: 'account', info: {} } } }), null)
  assert.equal(readMint(mint({ supply: '-5', decimals: 6 })), null)
  assert.equal(readMint(mint({ supply: '5', decimals: 40 })), null)
})

test('Token-2022 mints are read too, and live authorities are kept', () => {
  const m = readMint(mint({ supply: '5', decimals: 6, mintAuthority: 'abc', freezeAuthority: null }, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'))
  assert.equal(m?.mintAuthority, 'abc')
})
