import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchPhoneFrame, freshFrameTimestamp } from '../src/ui/phoneFrame'
const now = 1_800_000_000_000
const controller = new AbortController()
const response = (ts: string | null, type = 'image/jpeg', status = 200) => new Response(new Uint8Array([255, 216, 255, 217]), { status, headers: { ...(ts === null ? {} : { 'x-frame-timestamp': ts }), 'content-type': type } })

test('frame freshness rejects missing, future, expired, and malformed timestamps', () => {
  for (const ts of [null, '', 'NaN', '1.8e12', String(now + 1), String(now - 12_000), '0']) assert.equal(freshFrameTimestamp(ts, now), null)
  assert.equal(freshFrameTimestamp(String(now - 11_999), now), now - 11_999)
})
test('frame fetch uses current bytes and response identity, not stale status query or second network image', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (input, init) => {
    calls++
    assert.equal(input, '/api/screen')
    assert.equal(init?.cache, 'no-store')
    return response(String(now - 50))
  }
  const result = await fetchPhoneFrame(controller.signal, fetcher, () => now)
  assert.equal(calls, 1)
  assert.equal(result.ts, now - 50)
  assert.equal(result.blob.size, 4)
})
test('frame becoming stale while downloading, aborted, wrong media type or error response is rejected', async () => {
  let clock = now
  const fetcher: typeof fetch = async () => {
    const res = response(String(now - 11_000))
    const blob = res.blob.bind(res)
    res.blob = async () => { clock += 2000; return blob() }
    return res
  }
  await assert.rejects(fetchPhoneFrame(controller.signal, fetcher, () => clock))
  for (const res of [response(null), response(String(now), 'text/html'), response(String(now), 'image/jpeg', 404)]) await assert.rejects(fetchPhoneFrame(controller.signal, async () => res, () => now))
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(fetchPhoneFrame(aborted.signal, async () => response(String(now)), () => now))
})
