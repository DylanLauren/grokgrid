// Launchpad rules shared by the launch routes: what a bot draft may hold, the pool of
// trading wallets Grok Bot hands out, per-IP limits, and where pending launches live.
// No keys here: the pool only ever holds public addresses Grok Bot posted.
import { HOUSE_WALLET, isAddress, redis } from './_lib.js'

export const SITE_URL = (process.env.SITE_URL || 'https://grokgrid-alpha.vercel.app').replace(/\/$/, '')
export const BURN_WALLET = process.env.VITE_BURN_WALLET || ''
export const MAX_IMAGE_BYTES = 400_000
export const DRAFT_TTL = 86_400
export const LEASE_TTL = 900

// Mirrors FAMILY in src/ui/BotMark.tsx: the nine looks a bot can take.
export const LOOKS = [
  ['#0b0b0b', 'sphere'], ['#ff6a00', 'sphere'], ['#ff9a00', 'cloud'], ['#13b8a6', 'squircle'], ['#9b5cff', 'tile'],
  ['#1683ff', 'squircle'], ['#ff2e9a', 'cone'], ['#7a7a7a', 'drop'], ['#9a6a3f', 'sphere'],
] as const

export const keys = {
  image: (m: string) => `gg:img:${m}`,
  meta: (m: string) => `gg:meta:${m}`,
  pending: (m: string) => `gg:launch:${m}`,
  lease: (w: string) => `gg:lease:${w}`,
  pool: 'gg:pool',
  used: 'gg:pool:used',
}

export interface Draft {
  look: number
  name: string
  ticker: string
  description: string
  website: string
  x: string
  telegram: string
  strategy: string
  maxSol: number
  takeProfit: number
  stopLoss: number
  firstBuy: string
}

const bytes = (s: string) => new TextEncoder().encode(s).length
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function link(v: string, hosts: string[] | null, what: string) {
  if (!v) return ''
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw Error(`The ${what} link must be a full https link.`)
  }
  if (v.length > 200 || url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Links must be plain https links.')
  if (hosts && !hosts.includes(url.hostname)) throw Error(`Use a ${hosts[0]} link for ${what}.`)
  return url.toString()
}

function number(v: unknown, lo: number, hi: number, what: string) {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw Error(`${what} must be between ${lo} and ${hi}.`)
  return n
}

// Cleans and checks a draft. Throws a message fit to show the launcher.
export function cleanDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Fill in the bot.')
  const v = value as Record<string, unknown>
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '')
  const d: Draft = {
    look: Number.isInteger(v.look) && (v.look as number) >= 0 && (v.look as number) < LOOKS.length ? (v.look as number) : 0,
    name: str('name'),
    ticker: str('ticker').replace(/^\$/, '').toUpperCase(),
    description: str('description'),
    website: link(str('website'), null, 'website'),
    x: link(str('x'), ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], 'X'),
    telegram: link(str('telegram'), ['t.me'], 'Telegram'),
    strategy: str('strategy'),
    maxSol: number(v.maxSol, 0.01, 10, 'Max per trade'),
    takeProfit: number(v.takeProfit, 5, 10_000, 'Take profit'),
    stopLoss: number(v.stopLoss, 1, 95, 'Stop loss'),
    firstBuy: str('firstBuy'),
  }
  if (!d.name || bytes(d.name) > 32 || CONTROL.test(d.name)) throw Error('Name needs 1 to 32 characters.')
  if (!/^[A-Z0-9]{2,10}$/.test(d.ticker)) throw Error('Ticker needs 2 to 10 letters or numbers.')
  if (bytes(d.description) > 600 || CONTROL.test(d.description)) throw Error('Description must be 600 bytes or fewer.')
  if (!d.strategy || bytes(d.strategy) > 140 || CONTROL.test(d.strategy)) throw Error('Strategy needs one line, 140 bytes at most.')
  return d
}

// The token metadata pump.fun, wallets and explorers read, served from /m/<mint>.
export const metadataJson = (d: Draft, mint: string) => ({
  name: d.name,
  symbol: d.ticker,
  description: d.description,
  image: `${SITE_URL}/i/${mint}`,
  showName: true,
  createdOn: SITE_URL,
  website: d.website || `${SITE_URL}/#matrix`,
  ...(d.x ? { twitter: d.x } : {}),
  ...(d.telegram ? { telegram: d.telegram } : {}),
})

// A stable, readable id for the registry: ticker plus the start of the mint.
export const agentId = (ticker: string, mint: string) => `${ticker.toLowerCase()}-${mint.slice(0, 5).toLowerCase()}`.replace(/[^a-z0-9-]/g, '')

// ---- trading wallet pool ----
// Grok Bot makes each bot's trading wallet and keeps its key. It posts spare public
// addresses to /api/ingest ("wallets"); each launch borrows one for 15 minutes and keeps
// it once the coin is confirmed on chain.

export async function freeWallets(): Promise<number> {
  const [members] = await redis(['SMEMBERS', keys.pool])
  const wallets = ((members as string[]) ?? []).filter(isAddress)
  if (!wallets.length) return 0
  const busy = await redis(...wallets.map((w) => ['EXISTS', keys.lease(w)]))
  return busy.filter((n) => Number(n) === 0).length
}

export async function leaseWallet(mint: string): Promise<string | null> {
  const [members] = await redis(['SMEMBERS', keys.pool])
  for (const w of ((members as string[]) ?? []).filter(isAddress)) {
    const [ok] = await redis(['EVAL', `if redis.call('SISMEMBER', KEYS[1], ARGV[1]) ~= 1 or redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return false end return redis.call('SET', KEYS[3], ARGV[2], 'NX', 'EX', ARGV[3])`, 3, keys.pool, keys.used, keys.lease(w), w, mint, LEASE_TTL])
    if (ok === 'OK') return w
  }
  return null
}

// Compare ownership inside Redis, so an old request cannot release a newer lease.
export async function releaseWallet(wallet: string, mint: string) {
  await redis(['EVAL', `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, 1, keys.lease(wallet), mint])
}

// Before sending any signed bytes, remove expiry. Ambiguous network failures must
// retain this wallet until chain reconciliation proves failure or success.
export async function pinWallet(wallet: string, mint: string, expectedRecord: string, recoveryRecord: string): Promise<boolean> {
  const [ok] = await redis(['EVAL', `if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end redis.call('PERSIST', KEYS[1]) redis.call('SET', KEYS[2], ARGV[3]) redis.call('SADD', KEYS[3], ARGV[1]) return 1`, 3, keys.lease(wallet), keys.pending(mint), 'gg:launch:open', mint, expectedRecord, recoveryRecord])
  return Number(ok) === 1
}


export async function addWallets(list: string[]) {
  const fresh = [...new Set(list.filter(isAddress))].filter((w) => w !== BURN_WALLET && w !== HOUSE_WALLET)
  if (!fresh.length) return 0
  const [added] = await redis(['EVAL', `local count = 0 for _, w in ipairs(ARGV) do if redis.call('SISMEMBER', KEYS[2], w) == 0 then count = count + redis.call('SADD', KEYS[1], w) end end return count`, 2, keys.pool, keys.used, ...fresh])
  return Number(added ?? 0)
}

// ---- launch status ----
export async function launchStatus(): Promise<{ open: boolean; reason: string | null; free: number }> {
  // Wallet inventory alone cannot promise an operating agent. The executor is
  // still observe-only; activation must add a verified worker readiness check.
  if (!executorReady()) return { open: false, reason: 'Agent trading is not ready yet. Coin launches are paused.', free: 0 }
  if (!isAddress(BURN_WALLET)) return { open: false, reason: 'Launching opens once the burn wallet is set.', free: 0 }
  const free = await freeWallets().catch(() => -1)
  if (free < 0) return { open: false, reason: 'The launchpad is offline for a moment, try again soon.', free: 0 }
  if (free === 0) return { open: false, reason: 'No trading wallets are available. Coin launches are paused.', free: 0 }
  return { open: true, reason: null, free }
}

export const executorReady = (): boolean => false

// ---- per-IP limits ----
// Fixed one-minute windows in Redis. If Redis is down the request goes through.
export async function limited(req: Request, name: string, perMinute: number) {
  const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 64)
  const k = `gg:lim:${name}:${ip}:${Math.floor(Date.now() / 60_000)}`
  try {
    const [n] = await redis(['INCR', k], ['EXPIRE', k, 90])
    if (Number(n) > perMinute) return new Response(JSON.stringify({ error: 'Too many tries. Wait a minute.' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  } catch {
    /* never lock people out over a limiter */
  }
  return null
}

export const noStore = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// Our own messages are written for the launcher (capitalised, ending in a full stop); anything else is a bug or outage.
export const friendly = (e: unknown) => {
  const msg = e instanceof Error ? e.message : ''
  return /^[A-Z].*[.!]$/.test(msg) ? msg : null
}

export async function readJson<T>(req: Request, max: number): Promise<T | null> {
  const raw = await req.text()
  if (raw.length > max) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
