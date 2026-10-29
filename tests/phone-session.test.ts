import assert from 'node:assert/strict'
import test from 'node:test'
import { TokenVerifier } from 'livekit-server-sdk'
import { phoneSessionHandler } from '../api/_phone-session.ts'

const env = { LIVEKIT_URL: 'wss://example.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'only-a-test-secret-not-a-production-key' }
const request = (headers = {}, method = 'GET') => new Request('https://www.grokgrid.fun/api/phone-session?room=attacker&identity=publisher', { method, headers })
const handler = (overrides = {}) => phoneSessionHandler({ env: () => env, hasStore: () => false, redis: async () => [], ...overrides })

test('viewer tokens are independently verified, unique and strictly subscribe-only', async () => {
  const get = handler()
  const first = await get(request({ origin: 'https://www.grokgrid.fun', 'sec-fetch-site': 'same-origin' }))
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.equal(first.headers.get('access-control-allow-origin'), null)
  const body = await first.json()
  assert.deepEqual(Object.keys(body).sort(), ['room', 'token', 'trackName', 'url'])
  assert.equal(body.room, 'grokgrid-house')
  assert.equal(body.trackName, 'synthesized-camera')
  const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(body.token)
  assert.match(claims.sub!, /^viewer-[0-9a-f-]{36}$/)
  assert.equal(claims.exp! - claims.nbf!, 600)
  assert.deepEqual(claims.video, { room: 'grokgrid-house', roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false, roomAdmin: false, roomCreate: false, roomList: false, roomRecord: false, ingressAdmin: false })
  const second = await (await get(request())).json()
  assert.notEqual(second.token, body.token)
})

test('rejects cross-origin requests and non-GET methods before token issuance', async () => {
  const get = handler()
  for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }]) assert.equal((await get(request(headers))).status, 403)
  assert.equal((await get(request({}, 'POST'))).status, 405)
})

test('missing or unsafe configuration is unavailable and never leaks credentials', async () => {
  for (const config of [{}, { ...env, LIVEKIT_API_SECRET: '' }, { ...env, LIVEKIT_URL: 'https://example.livekit.cloud' }, { ...env, LIVEKIT_URL: 'wss://name:secret@example.livekit.cloud' }]) {
    const response = await handler({ env: () => config })(request())
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'Phone video unavailable' })
  }
})

test('bounds local issuance and resets after the minute window', async () => {
  let now = 60000
  const get = handler({ now: () => now })
  for (let i = 0; i < 12; i++) assert.equal((await get(request())).status, 200)
  const limited = await get(request())
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
  now += 60000
  assert.equal((await get(request())).status, 200)
})

test('shared Redis limits reject excess issuance and fail closed on invalid results', async () => {
  for (const counts of [[13, 13], [1, 301]]) assert.equal((await handler({ hasStore: () => true, redis: async () => [counts] })(request())).status, 429)
  for (const counts of [null, ['1', '1'], [1]]) assert.equal((await handler({ hasStore: () => true, redis: async () => [counts] })(request())).status, 503)
  const response = await handler({ hasStore: () => true, redis: async () => { throw Error('must-not-leak-secret') } })(request())
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes('must-not-leak'), false)
})
