import assert from 'node:assert/strict'
import { test } from 'node:test'
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only'
const { GET } = await import('../api/screen')
const { launchStatus } = await import('../api/_launch')

test('screen endpoint binds pixels to requested timestamp, expires and is only shared by the CDN for a second', async () => {
  const original = globalThis.fetch
  const now = Date.now()
  let pair: unknown[] = [Buffer.from('test frame').toString('base64'), String(now)]
  globalThis.fetch = async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), [['MGET', 'gg:screen', 'gg:screen:ts']])
    return Response.json([{ result: pair }])
  }
  try {
    const fresh = await GET(new Request(`https://example.test/api/screen?t=${now}`))
    assert.equal(fresh.status, 200)
    assert.equal(fresh.headers.get('cache-control'), 'public, max-age=0, s-maxage=1')
    assert.equal(await fresh.text(), 'test frame')
    assert.equal((await GET(new Request(`https://example.test/api/screen?t=${now - 1}`))).status, 404)
    for (const ts of [now - 12_001, now + 60_000, 0]) {
      pair = [pair[0], String(ts)]
      assert.equal((await GET(new Request('https://example.test/api/screen'))).status, 404)
    }
    pair = [null, String(now)]
    assert.equal((await GET(new Request('https://example.test/api/screen'))).status, 404)
  } finally { globalThis.fetch = original }
})

test('launching stays paused while worker has no execution implementation', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw Error('Wallet inventory cannot enable execution') }
  try {
    const status = await launchStatus()
    assert.equal(status.open, false)
    assert.match(status.reason!, /trading is not ready/)
  } finally { globalThis.fetch = original }
})
