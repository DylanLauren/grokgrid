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

test('live Matrix last-trade entries retain the mint and resolve its picture', async () => {
  const original = globalThis.fetch
  const { GET: agents } = await import('../api/agents')
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('redis.test')) {
        const body = String(init?.body)
        return body.includes('gg:agents') ? Response.json([{ result: [] }]) : Response.json([{ result: ['trades', '1'] }, { result: [JSON.stringify(call)] }])
      }
      if (url.includes('jup.ag')) return Response.json({})
      if (url.includes('dexscreener.com')) return Response.json([{ baseToken: { address: mint, symbol: 'Fartcoin', name: 'Fartcoin' }, info: { imageUrl: 'https://cdn.dexscreener.com/token.png' } }])
      throw new Error('Unexpected request')
    }
    const body = await (await agents()).json()
    assert.equal(body.mode, 'live')
    assert.equal(body.agents[0].last.mint, mint)
    assert.equal(body.agents[0].last.image, 'https://cdn.dexscreener.com/token.png')
    assert.equal(body.agents[0].last.pnlUsd, call.pnlUsd)
  } finally { globalThis.fetch = original }
})
