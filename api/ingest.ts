import { timingSafeEqual } from 'node:crypto'
import type { AgentRecord } from './agents.js'
import { HOUSE_WALLET, isAddress, isSig, json, parse, redis, signedBy } from './_lib.js'
import { addWallets, freeWallets } from './_launch.js'

// Grok Bot posts what it just did here, one event per request, with
//   Authorization: Bearer <INGEST_TOKEN>
// The token only lets it write the site's display data. It moves no money and
// the site still checks every trade signature and balance against the chain.
//
//   { "type": "trade",  "agent": "house", "side": "buy", "mint", "symbol", "name", "note",
//     "sizeTokens", "spentSol", "positionUsd", "pnlUsd", "entryMc", "nowMc", "sig" }
//   { "type": "agent",  "agent": { "id", "name", "color", "shape", "strategy", "wallet",
//     "coin": { "mint", "symbol", "name", "image" } } }
//   { "type": "fees",   "agent": "house", "feesSol": 1.2, "burnedMain": 350000 }   (running totals)
//   { "type": "wallet", "agent": "house", "sol": 2.31 }
//   { "type": "action", "text": "reading the trader list" }           (what he is doing right now)
//   { "type": "screen", "jpeg": "<base64 jpeg of his phone screen>" }  (live view, about one every 2s)
//   { "type": "wallets", "wallets": ["<public address>", ...] }       (spare trading wallets for new grid bots)
//   GET /api/ingest  (same token)  -> how many spare wallets are left and the latest launches to start trading

const TOKEN = process.env.INGEST_TOKEN || ''
const MAX_BODY = 8_000
const MAX_SCREEN = 450_000 // a 390x844 jpeg at quality 70 is about 60 KB, base64 adds a third
const PER_MINUTE = 120
const SHAPES = ['sphere', 'squircle', 'tile', 'cloud', 'cone', 'drop']
const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(ipfs\.io|pump\.fun|mypinata\.cloud|dexscreener\.com|arweave\.net|nftstorage\.link|irys\.xyz)\//i

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')
const num = (v: unknown, lo = -1e15, hi = 1e15) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{2,32}$/.test(v)
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

function authorised(req: Request) {
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!TOKEN || got.length !== TOKEN.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN))
}

export async function POST(req: Request) {
  if (!authorised(req)) return json({ error: 'unauthorised' }, 401)
  const raw = await req.text()
  if (raw.length > MAX_SCREEN) return json({ error: 'too large' }, 413)
  const ev = parse<Record<string, unknown>>(raw)
  if (!ev) return json({ error: 'bad json' }, 400)
  if (ev.type !== 'screen' && raw.length > MAX_BODY) return json({ error: 'too large' }, 413)

  const minute = Math.floor(Date.now() / 60_000)
  const [count] = await redis(['INCR', `gg:rate:${minute}`], ['EXPIRE', `gg:rate:${minute}`, 120])
  if (Number(count) > PER_MINUTE) return json({ error: 'slow down' }, 429)

  switch (ev.type) {
    case 'trade':
      return trade(ev)
    case 'agent':
      return agent(ev.agent as Record<string, unknown>)
    case 'fees':
      return fees(ev)
    case 'wallet':
      return wallet(ev)
    case 'action':
      return action(ev)
    case 'screen':
      return screen(ev)
    case 'wallets':
      return wallets(ev)
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
  const spentSol = num(ev.spentSol, 0, 1e4)
  const positionUsd = num(ev.positionUsd, 0)
  const pnlUsd = num(ev.pnlUsd)
  if (!side || !isAddress(ev.mint) || spentSol === null || positionUsd === null || pnlUsd === null) return json({ error: 'fields' }, 400)
  const sig = isSig(ev.sig) ? ev.sig : undefined
  const owner = await walletOf(id)
  if (!owner) return json({ error: 'unknown agent' }, 404)
  const verified = sig ? await signedBy(sig, owner) : false

  const ts = Date.now()
  const call = {
    id: sig || `${id}-${ts}`,
    ts,
    side,
    mint: ev.mint,
    symbol: text(ev.symbol, 16) || '???',
    name: text(ev.name, 48),
    hue: isHex(ev.hue) ? ev.hue : '#4ade80',
    image: typeof ev.image === 'string' && IMAGE_HOSTS.test(ev.image) ? ev.image : undefined,
    note: text(ev.note, 280),
    sizeTokens: num(ev.sizeTokens, 0) ?? 0,
    spentSol,
    positionUsd,
    pnlUsd,
    entryMc: num(ev.entryMc, 0) ?? 0,
    nowMc: num(ev.nowMc, 0) ?? 0,
    sig,
    verified,
  }
  // realised p&l in SOL: what it spent times the return on the position
  const cost = positionUsd - pnlUsd
  const pnlSol = side === 'sell' && cost > 0 ? spentSol * (pnlUsd / cost) : 0

  await redis(
    ['LPUSH', `gg:calls:${id}`, JSON.stringify(call)],
    ['LTRIM', `gg:calls:${id}`, 0, 199],
    ['HINCRBY', `gg:stats:${id}`, 'trades', 1],
    ['HSETNX', `gg:stats:${id}`, 'firstTs', ts],
    ...(side === 'sell'
      ? [
          ['HINCRBY', `gg:stats:${id}`, 'sells', 1],
          ['HINCRBY', `gg:stats:${id}`, 'wins', pnlUsd > 0 ? 1 : 0],
          ['HINCRBYFLOAT', `gg:stats:${id}`, 'pnlSol', pnlSol],
        ]
      : []),
  )
  return json({ ok: true, verified })
}

async function agent(a: Record<string, unknown> | undefined) {
  const coin = (a?.coin ?? {}) as Record<string, unknown>
  if (!a || !isId(a.id) || a.id === 'house' || !isAddress(a.wallet) || !isAddress(coin.mint)) return json({ error: 'fields' }, 400)
  const rec: AgentRecord = {
    id: a.id,
    name: text(a.name, 32) || a.id,
    color: isHex(a.color) ? a.color : '#1683ff',
    shape: SHAPES.includes(a.shape as string) ? (a.shape as string) : 'sphere',
    strategy: text(a.strategy, 140),
    launchedAt: Date.now(),
    wallet: a.wallet,
    coin: {
      mint: coin.mint,
      symbol: text(coin.symbol, 16),
      name: text(coin.name, 48),
      image: typeof coin.image === 'string' && IMAGE_HOSTS.test(coin.image) ? coin.image : undefined,
      hue: isHex(a.color) ? a.color : '#1683ff',
    },
  }
  // first write wins, so a later event cannot swap a bot's wallet or coin
  const [added] = await redis(['HSETNX', 'gg:agents', rec.id, JSON.stringify(rec)])
  return json({ ok: true, added: added === 1 })
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
  await redis(['SET', 'gg:screen', jpeg, 'EX', 60], ['SET', 'gg:screen:ts', ts, 'EX', 60])
  return json({ ok: true, ts })
}

// Spare trading wallets Grok Bot made (it keeps their keys). Each new grid bot gets one.
async function wallets(ev: Record<string, unknown>) {
  const list = Array.isArray(ev.wallets) ? ev.wallets.slice(0, 50) : []
  if (!list.length) return json({ error: 'fields' }, 400)
  const added = await addWallets(list.filter((w) => w !== HOUSE_WALLET))
  return json({ ok: true, added, free: await freeWallets() })
}

// What Grok Bot polls: spare wallets left, and launches it should start trading.
export async function GET(req: Request) {
  if (!authorised(req)) return json({ error: 'unauthorised' }, 401)
  const [list] = await redis(['LRANGE', 'gg:launches', 0, 49])
  const launches = ((list as string[]) ?? []).map((l) => parse(l)).filter(Boolean)
  return new Response(JSON.stringify({ free: await freeWallets(), launches }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
