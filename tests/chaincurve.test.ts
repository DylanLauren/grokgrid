import { test } from 'node:test'
import assert from 'node:assert/strict'

// a fake Upstash and a fake RPC behind one fetch
process.env.KV_REST_API_URL = 'https://redis.test'
process.env.KV_REST_API_TOKEN = 't'
const W = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const store = new Map<string, unknown>()
const sigs = [
  { signature: 's3', blockTime: 300 }, // newest first, as the chain answers
  { signature: 's2', blockTime: 200 },
  { signature: 's1', blockTime: 100 },
]
const bal: Record<string, number> = { s1: 85_000_000, s2: 1_255_000_000, s3: 1_261_000_000 }
let untils: (string | undefined)[] = []
globalThis.fetch = (async (url: string, init: { body: string }) => {
  const body = JSON.parse(init.body)
  if (String(url).startsWith('https://redis.test')) {
    return new Response(JSON.stringify((body as (string | number)[][]).map(([cmd, k, ...a]) => {
      const key = String(k)
      if (cmd === 'SET') { if (a.includes('NX') && store.has(key)) return { result: null }; store.set(key, a[0]); return { result: 'OK' } }
      if (cmd === 'GET') return { result: store.get(key) ?? null }
      if (cmd === 'DEL') { store.delete(key); return { result: 1 } }
      if (cmd === 'RPUSH') { store.set(key, [...((store.get(key) as string[]) ?? []), ...a]); return { result: 1 } }
      if (cmd === 'LTRIM') return { result: 'OK' }
      if (cmd === 'LRANGE') return { result: (store.get(key) as string[]) ?? [] }
      return { result: null }
    })))
  }
  if (body.method === 'getSignaturesForAddress') {
    const until = body.params[1].until
    untils.push(until)
    const i = until ? sigs.findIndex((s) => s.signature === until) : sigs.length
    return new Response(JSON.stringify({ result: sigs.slice(0, i) }))
  }
  const sig = body.params[0]
  return new Response(JSON.stringify({ result: { blockTime: sigs.find((s) => s.signature === sig)!.blockTime, meta: { postBalances: [bal[sig]] }, transaction: { message: { accountKeys: [W] } } } }))
}) as typeof fetch

test('wallet history comes from the chain, top-ups included, and only new transactions are read', async () => {
  const { chainCurve } = await import('../api/_curve.ts')
  const a = await chainCurve('house', W)
  assert.deepEqual(a?.map((p) => [p.ts, p.sol]), [[100000, 0.085], [200000, 1.255], [300000, 1.261]])
  store.delete('gg:chaincurve:house:lock')
  sigs.unshift({ signature: 's4', blockTime: 400 })
  bal.s4 = 1_262_000_000
  untils = []
  const b = await chainCurve('house', W)
  assert.deepEqual(untils, ['s3'])
  assert.deepEqual(b?.map((p) => p.sol), [0.085, 1.255, 1.261, 1.262])
})
