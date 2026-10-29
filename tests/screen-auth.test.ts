import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { ingestScope } from '../api/_ingest-auth'

const secret = 'unit-test-only', now = 1_800_000_000_000
function token(exp = now + 60_000) {
  const payload = `screen-v1.${Math.floor(exp / 1000)}.${'a'.repeat(32)}`
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
}
test('screen credentials are scoped, expiring and bound to the main secret', () => {
  assert.equal(ingestScope(`Bearer ${token()}`, secret, now), 'screen')
  assert.equal(ingestScope(`Bearer ${secret}`, secret, now), 'full')
  assert.equal(ingestScope(`Bearer ${token(now)}`, secret, now), null)
  assert.equal(ingestScope(`Bearer ${token(now + 8 * 86_400_000)}`, secret, now), null)
  assert.equal(ingestScope(`Bearer ${token()}`, 'rotated', now), null)
  assert.equal(ingestScope(`Bearer ${token().slice(0, -2)}00`, secret, now), null)
})
test('malformed and multibyte credentials fail without throwing', () => {
  for (const value of [null, '', 'é'.repeat(secret.length), 'Bearer screen-v1.bad', 'Bearer ']) {
    assert.equal(ingestScope(value, secret, now), null)
  }
  assert.equal(ingestScope('Bearer x', ''), null)
})
process.env.INGEST_TOKEN = secret
const { GET, POST } = await import('../api/ingest')
test('screen credential cannot read queue or mutate wallets, agents, actions or trades', async () => {
  const headers = { authorization: `Bearer ${token(Date.now() + 60_000)}`, 'content-type': 'application/json' }
  assert.equal((await GET(new Request('https://example.test/api/ingest', { headers }))).status, 401)
  for (const type of ['wallets', 'agent', 'trade', 'fees', 'wallet', 'action']) {
    assert.equal((await POST(new Request('https://example.test/api/ingest', { method: 'POST', headers, body: JSON.stringify({ type }) }))).status, 403)
  }
})
test('screen credential reaches JPEG validation without gaining full scope', async () => {
  const response = await POST(new Request('https://example.test/api/ingest', { method: 'POST', headers: { authorization: `Bearer ${token(Date.now() + 60_000)}` }, body: JSON.stringify({ type: 'screen', jpeg: 'invalid' }) }))
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'jpeg' })
})
test('even full ingestion credentials cannot bypass verified launch registration', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('retired registration must not mutate storage') }
  try {
    for (const type of ['agent', 'wallets']) {
      const response = await POST(new Request('https://example.test/api/ingest', {
        method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ type }),
      }))
      assert.equal(response.status, 410)
    }
  } finally { globalThis.fetch = original }
})
