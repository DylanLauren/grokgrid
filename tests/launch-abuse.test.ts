import assert from 'node:assert/strict'
import { test } from 'node:test'
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only'
const { POST } = await import('../api/launch/asset')

test('coin pictures are refused while launches are paused, before anything is stored', async () => {
  const original = globalThis.fetch
  const sent: unknown[] = []
  globalThis.fetch = async (_input, init) => {
    const cmds = JSON.parse(String(init?.body)) as string[][]
    sent.push(...cmds)
    return Response.json(cmds.map(() => ({ result: 1 })))
  }
  try {
    const res = await POST(new Request('https://example.test/api/launch/asset', {
      method: 'POST',
      body: JSON.stringify({ mint: '11111111111111111111111111111111', image: 'data:image/png;base64,iVBORw0KGgo=' }),
    }))
    assert.equal(res.status, 503)
    assert.ok(sent.every((c) => (c as string[])[0] !== 'SET'))
  } finally { globalThis.fetch = original }
})
