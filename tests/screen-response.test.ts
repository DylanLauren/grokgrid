import assert from 'node:assert/strict'
import { test } from 'node:test'
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only'
const { GET } = await import('../api/screen')
const { launchStatus } = await import('../api/_launch')
const { GET: getLive } = await import('../api/live')

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
    assert.equal(fresh.headers.get('x-frame-timestamp'), String(now))
    assert.equal(fresh.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(await fresh.text(), 'test frame')
    assert.equal((await GET(new Request(`https://example.test/api/screen?t=${now - 1}`))).status, 404)
    for (const ts of [now - 12_001, now + 60_000, 0]) {
      pair = [pair[0], String(ts)]
      const rejected = await GET(new Request('https://example.test/api/screen'))
      assert.equal(rejected.status, 404)
      assert.equal(rejected.headers.get('cache-control'), 'no-store')
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

test('live metadata keeps one-second CDN sharing and carries the exact frame timestamp', async () => {
  const original = globalThis.fetch
  const timestamp = Date.now()
  globalThis.fetch = async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), [['LRANGE', 'gg:actions', 0, 11], ['GET', 'gg:screen:ts']])
    return Response.json([{ result: [JSON.stringify({ ts: timestamp, text: 'Observing' })] }, { result: String(timestamp) }])
  }
  try {
    const result = await getLive()
    assert.equal(result.headers.get('cache-control'), 'public, max-age=0, s-maxage=1')
    assert.deepEqual(await result.json(), { actions: [{ ts: timestamp, text: 'Observing' }], screenTs: timestamp })
  } finally { globalThis.fetch = original }
})
