import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeLaunchEvents, isLaunchCursor } from '../api/_launch-events'
import { GET } from '../api/launch/events'
import { createHmac } from 'node:crypto'

const mint = '11111111111111111111111111111111'
const wallet = 'So11111111111111111111111111111111111111112'
const row = (cursor: string, token = mint) => [cursor, token, JSON.stringify({ id: 'grid-test', mint: token, wallet, ts: 1234 })]

test('outbox pages retain cursors beyond fifty and permit sequence gaps', () => {
  const page = decodeLaunchEvents(['109', [row('102'), row('109', wallet)]], '99', 1)
  assert.equal(page.nextCursor, '102')
  assert.equal(page.hasMore, true)
  assert.equal(page.events.length, 1)
  assert.equal(page.executionEnabled, false)
  const last = decodeLaunchEvents(['109', [row('109', wallet)]], '102', 1)
  assert.equal(last.nextCursor, '109')
  assert.equal(last.hasMore, false)
  assert.deepEqual(decodeLaunchEvents(['109', []], '109', 50).events, [])
})

test('outbox refuses corrupt, missing, reordered, duplicate and future cursors', () => {
  for (const bad of [null, ['2', []], ['2', [row('2'), row('1')]], ['2', [row('1'), row('2')]], ['2', [['2', mint, '{}']]], ['2', [['2', wallet, row('2')[2]]]]]) {
    assert.throws(() => decodeLaunchEvents(bad, '0', 50))
  }
  assert.throws(() => decodeLaunchEvents(['1', []], '2', 50), /cursor-ahead/)
  for (const bad of ['01', '-1', '1.1', '1e2', '9007199254740992', '', null]) assert.equal(isLaunchCursor(bad), false)
  assert.equal(isLaunchCursor('9007199254740991'), true)
})

test('outbox requires full ingestion scope and never caches authentication failures', async () => {
  const saved = process.env.INGEST_TOKEN
  process.env.INGEST_TOKEN = 'local-test-only'
  try {
    const denied = await GET(new Request('https://example.invalid/api/launch/events'))
    assert.equal(denied.status, 401)
    assert.equal(denied.headers.get('cache-control'), 'no-store')
    const payload = `screen-v1.${Math.floor(Date.now() / 1000) + 3600}.${'a'.repeat(32)}`
    const cap = `${payload}.${createHmac('sha256', process.env.INGEST_TOKEN).update(payload).digest('hex')}`
    assert.equal((await GET(new Request('https://example.invalid/api/launch/events', { headers: { authorization: `Bearer ${cap}` } }))).status, 403)
    assert.equal((await GET(new Request('https://example.invalid/api/launch/events?after=1&after=2', { headers: { authorization: 'Bearer local-test-only' } }))).status, 400)
  } finally {
    if (saved === undefined) delete process.env.INGEST_TOKEN
    else process.env.INGEST_TOKEN = saved
  }
})
