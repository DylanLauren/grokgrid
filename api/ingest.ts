import { ingestScope } from './_ingest-auth.js'
import type { AgentRecord } from './agents.js'
import { HOUSE_WALLET, isAddress, isSig, json, parse, redis } from './_lib.js'
import { verifyTradeReceipt } from './_trade-receipt.js'
import { readBeat, saveBeat } from './_heartbeat.js'

// Grok Bot posts what it just did here, one event per request, with
//   Authorization: Bearer <INGEST_TOKEN>
// The token only lets it write the site's display data. It moves no money and
// the site still checks every trade signature and balance against the chain.
//
//   { "type": "trade",  "agent": "house", "side": "buy", "mint", "symbol", "name", "note",
//     "sizeTokens", "spentSol", "positionUsd", "pnlUsd", "entryMc", "nowMc", "sig" }
//   { "type": "fees",   "agent": "house", "feesSol": 1.2, "burnedMain": 350000 }   (running totals)
//   { "type": "wallet", "agent": "house", "sol": 2.31 }
//   { "type": "action", "text": "reading the trader list" }           (what he is doing right now)
//   { "type": "runtime", "worker": "agent-runner", "mode": "execute", "healthy": true, "agents": 3, "note": "" }
//   { "type": "screen", "jpeg": "<base64 jpeg of his phone screen>" }  (live view, about one every 2s)
//   Agent registration happens only through verified launch confirmation.
//   GET /api/launch/events (same token) delivers durable observation pages.
//   GET /api/ingest is a legacy bounded launch list, not execution authorization.

const TOKEN = process.env.INGEST_TOKEN || ''
const MAX_BODY = 8_000
const MAX_SCREEN = 450_000 // a 390x844 jpeg at quality 70 is about 60 KB, base64 adds a third
const PER_MINUTE = 120
const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(ipfs\.io|pump\.fun|mypinata\.cloud|dexscreener\.com|arweave\.net|nftstorage\.link|irys\.xyz)\//i

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')
const num = (v: unknown, lo = -1e15, hi = 1e15) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{2,32}$/.test(v)
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

export async function POST(req: Request) {
  const scope = ingestScope(req.headers.get('authorization'), TOKEN)
  if (!scope) return json({ error: 'unauthorised' }, 401)
  const raw = await req.text()
  if (raw.length > MAX_SCREEN) return json({ error: 'too large' }, 413)
  const ev = parse<Record<string, unknown>>(raw)
  if (!ev) return json({ error: 'bad json' }, 400)
  if (scope === 'screen' && ev.type !== 'screen') return json({ error: 'screen-only credential' }, 403)
  if (ev.type !== 'screen' && raw.length > MAX_BODY) return json({ error: 'too large' }, 413)

  if (ev.type === 'agent') return json({ error: 'Agents must be registered through a verified launch.' }, 410)
  if (ev.type === 'wallets') return json({ error: 'Spare-wallet registration is retired; new agents use their launcher wallet.' }, 410)

  const minute = Math.floor(Date.now() / 60_000)
  const [count] = await redis(['INCR', `gg:rate:${minute}`], ['EXPIRE', `gg:rate:${minute}`, 120])
  if (Number(count) > PER_MINUTE) return json({ error: 'slow down' }, 429)

  switch (ev.type) {
    case 'trade':
      return trade(ev)
    case 'fees':
      return fees(ev)
    case 'wallet':
      return wallet(ev)
    case 'action':
      return action(ev)
    case 'screen':
      return screen(ev)
    case 'runtime': {
      const beat = readBeat(ev)
      if (!beat) return json({ error: 'A runtime beat needs worker, mode and healthy.' }, 400)
      await saveBeat(beat)
      return json({ ok: true })
    }
    default:
      return json({ error: 'unknown type' }, 400)
  }
}

async function walletOf(id: string): Promise<string> {
  if (id === 'house') return HOUSE_WALLET
  const [rec] = await redis(['HGET', 'gg:agents', id])
  return parse<AgentRecord>(rec)?.wallet ?? ''
}

async function trade(ev: Record<string, unknown>) {
  const id = ev.agent
  if (!isId(id)) return json({ error: 'agent' }, 400)
  const side = ev.side === 'buy' || ev.side === 'sell' ? ev.side : null
  if (!side || !isAddress(ev.mint) || !isSig(ev.sig)) return json({ error: 'A trade requires a mint, side and finalized signature.' }, 400)
  const owner = await walletOf(id)
  if (!owner) return json({ error: 'unknown agent' }, 404)
  const receipt = await verifyTradeReceipt(ev.sig, owner, ev.mint, side)
  if (!receipt.ok) return json({ error: receipt.reason }, receipt.unavailable ? 503 : 422)
  const ts = receipt.blockTime * 1000
  const call = {
    id: `${ev.sig}:${ev.mint}`, ts, side, mint: ev.mint,
    symbol: text(ev.symbol, 16) || '???', name: text(ev.name, 48),
    hue: isHex(ev.hue) ? ev.hue : '#4ade80',
    image: typeof ev.image === 'string' && IMAGE_HOSTS.test(ev.image) ? ev.image : undefined,
    note: text(ev.note, 280), sizeTokens: receipt.sizeTokens,
    // This is the checked SOL balance movement, not an independently decoded price.
    spentSol: receipt.solFlow, tokenAmountRaw: receipt.tokenAmountRaw,
    tokenDecimals: receipt.tokenDecimals, solFlowLamports: receipt.solFlowLamports,
    positionUsd: null, pnlUsd: null, entryMc: null, nowMc: null,
    sig: ev.sig, verified: true, verification: receipt.verification, accountingVerified: false,
  }
  // Deduplicate one wallet/mint movement per signature, atomically with the feed.
  // No caller-reported USD amount can change realized PnL or wins.
  const [saved] = await redis(['EVAL', `
    local expected = {'set', 'list', 'hash'}
    for i = 1, 3 do
      local kind = redis.call('TYPE', KEYS[i]).ok
      if kind ~= 'none' and kind ~= expected[i] then return -1 end
    end
    local trades = redis.call('HGET', KEYS[3], 'trades')
    if trades and ((trades ~= '0' and not string.match(trades, '^[1-9]%d*$')) or string.len(trades) > 15) then return -1 end
    if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 0 end
    redis.call('SADD', KEYS[1], ARGV[1])
    redis.call('LPUSH', KEYS[2], ARGV[2])
    redis.call('LTRIM', KEYS[2], 0, 199)
    redis.call('HINCRBY', KEYS[3], 'trades', 1)
    redis.call('HSETNX', KEYS[3], 'firstTs', ARGV[3])
    return 1
  `, 3, 'gg:trade:receipts', `gg:calls:${id}`, `gg:stats:${id}`,
  `${owner}:${ev.sig}:${ev.mint}`, JSON.stringify(call), ts])
  if (saved !== 0 && saved !== 1) return json({ error: 'Trade store unavailable; retry the same receipt.' }, 503)
  return new Response(JSON.stringify({ ok: true, duplicate: saved === 0, verified: true, verification: receipt.verification, accountingVerified: false }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function fees(ev: Record<string, unknown>) {
  if (!isId(ev.agent)) return json({ error: 'agent' }, 400)
  const feesSol = num(ev.feesSol, 0, 1e7)
  const burned = num(ev.burnedMain, 0)
  const cmds: (string | number)[][] = []
  if (feesSol !== null) cmds.push(['HSET', `gg:stats:${ev.agent}`, 'feesSol', feesSol])
  if (burned !== null) cmds.push(['HSET', `gg:stats:${ev.agent}`, 'burnedMain', burned])
  if (!cmds.length) return json({ error: 'fields' }, 400)
  await redis(...cmds)
  return json({ ok: true })
}

async function wallet(ev: Record<string, unknown>) {
  const sol = num(ev.sol, 0, 1e7)
  if (!isId(ev.agent) || sol === null) return json({ error: 'fields' }, 400)
  await redis(['RPUSH', `gg:curve:${ev.agent}`, JSON.stringify({ ts: Date.now(), sol })], ['LTRIM', `gg:curve:${ev.agent}`, -500, -1])
  return json({ ok: true })
}

async function action(ev: Record<string, unknown>) {
  const t = text(ev.text, 120)
  if (!t) return json({ error: 'fields' }, 400)
  await redis(['LPUSH', 'gg:actions', JSON.stringify({ ts: Date.now(), text: t })], ['LTRIM', 'gg:actions', 0, 29])
  return json({ ok: true })
}

// Only the latest frame is kept, and it expires a minute after he stops sending.
async function screen(ev: Record<string, unknown>) {
  const jpeg = typeof ev.jpeg === 'string' ? ev.jpeg.replace(/^data:image\/jpeg;base64,/, '') : ''
  if (!jpeg.startsWith('/9j/') || !/^[A-Za-z0-9+/=]+$/.test(jpeg)) return json({ error: 'jpeg' }, 400)
  const ts = Date.now()
  const [saved] = await redis(['EVAL', `redis.call('SET', KEYS[1], ARGV[1], 'EX', 60); redis.call('SET', KEYS[2], ARGV[2], 'EX', 60); return 1`, 2, 'gg:screen', 'gg:screen:ts', jpeg, ts])
  if (saved !== 1) return json({ error: 'Screen store unavailable.' }, 503)
  return json({ ok: true, ts })
}

// Legacy bounded display list. Durable workers use /api/launch/events.
export async function GET(req: Request) {
  if (ingestScope(req.headers.get('authorization'), TOKEN) !== 'full') return json({ error: 'unauthorised' }, 401)
  const [list] = await redis(['LRANGE', 'gg:launches', 0, 49])
  if (!Array.isArray(list)) return json({ error: 'Launch list unavailable.' }, 503)
  const launches = list.map((l) => parse(l)).filter(Boolean)
  return new Response(JSON.stringify({ free: null, walletModel: 'launcher', launches, historyComplete: false, executionEnabled: false }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
