import test from 'node:test'
import assert from 'node:assert/strict'
import { planPosts, sellPnlPct, recapStats, previousUtcDay } from '../scripts/x-plan.mjs'
import { pendingPosts, uploadMedia, sendPost, oauthHeader } from '../scripts/x-posts.mjs'

const now = Date.parse('2026-10-29T01:00:00Z'), yesterday = Date.parse('2026-10-28T15:00:00Z')
const MINT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const sig = (n: number) => '5'.repeat(87) + n
const buy = (n: number, at: number) => ({ state: 'reconciled-confirmed', side: 'buy', mint: MINT, signature: sig(n), createdAt: at, receipt: { spentLamports: '50000000', receivedTokenUnits: '1000000' } })
const sell = (n: number, at: number, received: string) => ({ state: 'reconciled-confirmed', side: 'sell', mint: MINT, signature: sig(n), createdAt: at, receipt: { soldTokenUnits: '1000000', receivedLamports: received } })
const creds = { apiKey: 'key-12345678', apiSecret: 'secret-12345678', accessToken: 'token-12345678', accessSecret: 'asecret-12345678' }

test('plans each real trade once, flags a +50% sell as notable, adds burns, launches and the recap', () => {
  const state = { intents: [buy(1, yesterday), sell(2, yesterday + 1000, '80000000'), { ...buy(3, yesterday), state: 'held-ambiguous' }] }
  const buyback = { cycles: [{ id: 'c1', state: 'burned', mint: MINT, createdAt: yesterday, spendLamports: '50000000', burn: { tokenUnits: '2500000000', signature: sig(9) } }, { id: 'c2', state: 'buy-pending', mint: MINT, createdAt: yesterday }] }
  const items = planPosts({ journals: [{ agent: 'house', state }], buyback, launches: [{ id: 'bot-1', mint: MINT, queuedAt: yesterday }], registry: [{ id: 'bot-1', coin: { symbol: 'BOT' } }], ledger: { posted: {} }, now, pendingPosts })
  assert.deepEqual(items.map(i => i.key).sort(), [sig(1), sig(2), 'burn:c1', 'launch:bot-1', `recap:${previousUtcDay(now)}`].sort())
  assert.equal(items.find(i => i.key === sig(2))!.notable, true)
  assert.equal(Math.round(items.find(i => i.key === sig(2))!.pnlPct), 60)
  assert.equal(items.find(i => i.key === sig(1))!.notable, false)
  assert.match(items.find(i => i.key === 'burn:c1')!.text('GRID', 'https://grokgrid-alpha.vercel.app'), /burned 2,500 \$GRID/)
  const posted = Object.fromEntries(items.map(i => [i.key, { outcome: 'posted', at: now }]))
  assert.equal(planPosts({ journals: [{ agent: 'house', state }], buyback, launches: [{ id: 'bot-1', mint: MINT, queuedAt: yesterday }], registry: [], ledger: { posted }, now, pendingPosts }).length, 0)
})

test('no activity means no recap; recap stats count wins against average cost', () => {
  assert.equal(planPosts({ journals: [], buyback: null, launches: [], registry: [], ledger: { posted: {} }, now, pendingPosts }).length, 0)
  const state = { intents: [buy(1, yesterday), sell(2, yesterday + 1, '40000000')] }
  assert.equal(Math.round(sellPnlPct(state, state.intents[1])!), -20)
  const s = recapStats([{ agent: 'house', state }], null, '2026-10-28')
  assert.deepEqual({ trades: s.trades, winRate: s.winRate, solIn: s.solIn, solOut: s.solOut }, { trades: 2, winRate: 0, solIn: 0.04, solOut: 0.05 })
})

test('chunked upload: initialize, append every chunk, finalize, poll status until processed', async () => {
  const calls: { method: string; url: string; auth: string }[] = []
  let polls = 0
  const fake = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ method: init.method, url, auth: init.headers.authorization })
    const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as unknown as Response
    if (url.endsWith('/initialize')) return json({ data: { id: '1234567890' } })
    if (url.endsWith('/append')) return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
    if (url.endsWith('/finalize')) return json({ data: { processing_info: { state: 'pending', check_after_secs: 1 } } })
    polls++; return json({ data: { processing_info: { state: polls < 2 ? 'in_progress' : 'succeeded' } } })
  }
  const id = await uploadMedia(Buffer.alloc(9 * 1024 * 1024), 'video/mp4', creds, fake as typeof fetch, { sleep: async () => {} })
  assert.equal(id, '1234567890')
  assert.equal(calls.filter(c => c.url.endsWith('/append')).length, 3)
  assert.ok(calls.every(c => c.auth.startsWith('OAuth ') && !c.auth.includes('secret-12345678')))
  assert.ok(calls.some(c => c.method === 'GET' && c.url.includes('command=STATUS')))
})

test('a failed or rejected upload returns null so the post goes out as text', async () => {
  const fail = async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response
  assert.equal(await uploadMedia(Buffer.alloc(10), 'image/png', creds, fail as typeof fetch), null)
  const failed = async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith('/initialize') ? { data: { id: '42' } } : { data: { processing_info: { state: 'failed' } } } }) as unknown as Response
  assert.equal(await uploadMedia(Buffer.alloc(10), 'video/mp4', creds, failed as typeof fetch, { sleep: async () => {} }), null)
})

test('posts attach media ids, and query parameters are part of the OAuth signature', async () => {
  let body: { media?: { media_ids: string[] } } = {}
  await sendPost('hi', creds, (async (_u: string, init: { body: string }) => { body = JSON.parse(init.body); return { status: 201, json: async () => ({ data: { id: '9' } }) } }) as unknown as typeof fetch, ['77'])
  assert.deepEqual(body.media, { media_ids: ['77'] })
  const a = oauthHeader('GET', 'https://api.x.com/2/media/upload?command=STATUS&media_id=1', creds, 'n', 1)
  const b = oauthHeader('GET', 'https://api.x.com/2/media/upload?command=STATUS&media_id=2', creds, 'n', 1)
  assert.notEqual(a, b)
})
