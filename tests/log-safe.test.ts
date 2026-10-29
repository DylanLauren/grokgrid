import test from 'node:test'
import assert from 'node:assert/strict'
import { safeError } from '../scripts/log-safe.mjs'

test('log lines never carry provider URLs with keys, tokens or control characters', () => {
  const e = Error('failed to fetch https://mainnet.helius-rpc.com/?api-key=SECRET123 (status 429)\ntoken=abc')
  const out = safeError(e)
  assert.ok(!out.includes('SECRET123') && !out.includes('abc') && !out.includes('\n'))
  assert.ok(out.includes('https://mainnet.helius-rpc.com'))
  assert.equal(safeError('x'.repeat(500)).length, 160)
})
