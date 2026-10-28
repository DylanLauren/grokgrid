import assert from 'node:assert/strict'
import { test } from 'node:test'

// Mock only the external services. Exercise the actual feed handler and market parser.
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only'
const { GET } = await import('../api/feed')
const mint = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'
const call = { mint, symbol: 'old', name: 'old', spentSol: 0.4, pnlUsd: 12, entryMc: 10, nowMc: 20, sig: 'recorded-signature' }

test('live feed resolves token metadata by mint without rewriting executed trade data', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.includes('redis.test')) return Response.json([{ result: [JSON.stringify(call)] }, { result: [] }, { result: [] }])
      if (url.includes('jup.ag')) return Response.json({})
      if (url.includes('dexscreener.com')) return Response.json([{ baseToken: { address: mint, symbol: 'Fartcoin', name: 'Fartcoin' }, liquidity: { usd: 1000 }, marketCap: 99999, info: { imageUrl: 'https://cdn.dexscreener.com/token.png' } }])
      throw new Error('Unexpected request')
    }
    const body = await (await GET()).json()
    assert.equal(body.calls[0].image, 'https://cdn.dexscreener.com/token.png')
    assert.equal(body.calls[0].symbol, 'Fartcoin')
    for (const key of ['spentSol', 'pnlUsd', 'entryMc', 'nowMc', 'sig'] as const) assert.equal(body.calls[0][key], call[key])
  } finally { globalThis.fetch = original }
})
