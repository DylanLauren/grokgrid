import test from 'node:test'
import assert from 'node:assert/strict'
import { fallbackFetch, fallbackUrl, PUBLIC_RPC } from '../scripts/rpc-fallback.mjs'

const P = 'https://primary.example/rpc', F = 'https://fallback.example/rpc'
const fake = (plan: Record<string, number | 'throw'>) => {
  const calls: string[] = []
  const f = async (url: string) => { calls.push(url); const p = plan[url]; if (p === 'throw') throw Error('net'); return new Response('{}', { status: p as number }) }
  return { f: f as unknown as typeof fetch, calls }
}

test('a healthy primary is used alone; 429, 5xx or a network error retries once on the fallback', async () => {
  for (const [primary, expectCalls] of [[200, [P]], [400, [P]], [429, [P, F]], [503, [P, F]], ['throw', [P, F]]] as const) {
    const { f, calls } = fake({ [P]: primary, [F]: 200 })
    const r = await fallbackFetch(P, F, f)(P, { method: 'POST', body: '{}' })
    assert.deepEqual(calls, expectCalls, String(primary)); assert.ok(r.status === (expectCalls.length === 1 ? primary : 200))
  }
})

test('no fallback, or the same URL: the primary result or error stands', async () => {
  const { f, calls } = fake({ [P]: 503 })
  assert.equal((await fallbackFetch(P, P, f)(P, {})).status, 503); assert.deepEqual(calls, [P])
  await assert.rejects(fallbackFetch(P, '', fake({ [P]: 'throw' }).f)(P, {}))
})

test('fallback URL comes from GROKGRID_RPC_FALLBACK when it is https, else the public RPC', () => {
  assert.equal(fallbackUrl({ GROKGRID_RPC_FALLBACK: F }), F)
  assert.equal(fallbackUrl({ GROKGRID_RPC_FALLBACK: 'http://insecure.example' }), PUBLIC_RPC)
  assert.equal(fallbackUrl({}), PUBLIC_RPC)
})
