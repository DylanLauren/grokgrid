// Launchpad rules shared by the launch routes: what a bot draft may hold, per-IP limits,
// and where pending launches live. No keys here: each bot trades from its launcher's wallet.
import { beats, runnerReady } from './_heartbeat.js'
import { isAddress, redis } from './_lib.js'

export const SITE_URL = (process.env.SITE_URL || 'https://www.grokgrid.fun').replace(/\/$/, '')
export const BURN_WALLET = process.env.VITE_BURN_WALLET || ''
export const MAX_IMAGE_BYTES = 400_000
// A picture and its metadata wait this long for their coin; sending a launch keeps them for good.
export const DRAFT_TTL = 7_200
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
  launcher: (w: string) => `gg:launcher:${w}`,
}

export interface Draft {
  look: number
  name: string // the coin's name on pump.fun
  botName: string // the bot's own name on the grid; the coin name when left blank
  ticker: string
  description: string
  x: string
  telegram: string
  strategy: string
  maxSol: number
  takeProfit: number
  stopLoss: number
  style: Style
  firstBuy: string
}

// How a bot hunts: each style screens for different coins and exits on its own clock, inside the house rules.
export const STYLES = ['early', 'momentum', 'steady'] as const
export type Style = (typeof STYLES)[number]

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

// Names only the house bot and the site itself may use, so nobody can pass as them.
const RESERVED = ['house', 'housetrader', 'housebot', 'grokgrid', 'grokgridofficial', 'grok', 'grokbot', 'thegrokbot', 'official', 'admin', 'grid', 'gridcoin', 'grokgridcoin', 'officialgrid']
export const reservedName = (name: string) => RESERVED.includes(name.toLowerCase().replace(/[^a-z0-9]/g, ''))
// The official coin's ticker and close copies of it, so nobody can launch a lookalike $GRID.
const RESERVED_TICKERS = ['GRID', 'GROK', 'GROKGRID', 'GRIDS', 'GG']
export const reservedTicker = (t: string) => RESERVED_TICKERS.includes(t.toUpperCase())

// Cleans and checks a draft. Throws a message fit to show the launcher.
export function cleanDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Fill in the bot.')
  const v = value as Record<string, unknown>
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '')
  const d: Draft = {
    look: Number.isInteger(v.look) && (v.look as number) >= 0 && (v.look as number) < LOOKS.length ? (v.look as number) : 0,
    name: str('name'),
    botName: str('botName') || str('name'),
    ticker: str('ticker').replace(/^\$/, '').toUpperCase(),
    description: str('description'),
    x: link(str('x'), ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], 'X'),
    telegram: link(str('telegram'), ['t.me'], 'Telegram'),
    strategy: str('strategy'),
    maxSol: number(v.maxSol, 0.01, 10, 'Max per trade'),
    takeProfit: number(v.takeProfit, 5, 60, 'Take profit'), // the house exits are the loosest a bot may run
    stopLoss: number(v.stopLoss, 1, 25, 'Stop loss'),
    style: STYLES.includes(v.style as Style) ? (v.style as Style) : 'steady',
    firstBuy: str('firstBuy'),
  }
  if (!d.name || bytes(d.name) > 32 || CONTROL.test(d.name)) throw Error('Name needs 1 to 32 characters.')
  if (bytes(d.botName) > 32 || CONTROL.test(d.botName)) throw Error('Bot name needs 32 characters at most.')
  if (reservedName(d.botName) || reservedName(d.name)) throw Error('That name belongs to the house. Pick another.')
  if (!/^[A-Z0-9]{2,10}$/.test(d.ticker)) throw Error('Ticker needs 2 to 10 letters or numbers.')
  if (reservedTicker(d.ticker)) throw Error('That ticker belongs to the official coin. Pick another.')
  if (bytes(d.description) > 600 || CONTROL.test(d.description)) throw Error('Description must be 600 bytes or fewer.')
  if (!d.strategy || bytes(d.strategy) > 140 || CONTROL.test(d.strategy)) throw Error('Strategy needs one line, 140 bytes at most.')
  return d
}

export const botUrl = (mint: string) => `${SITE_URL}/#matrix/${mint}`

// The token metadata pump.fun, wallets and explorers read, served from /m/<mint>.
export const metadataJson = (d: Draft, mint: string) => ({
  name: d.name,
  symbol: d.ticker,
  description: d.description,
  image: `${SITE_URL}/i/${mint}`,
  showName: true,
  createdOn: SITE_URL,
  // every coin launched here links to its own bot's profile on GrokGrid
  website: botUrl(mint),
  ...(d.x ? { twitter: d.x } : {}),
  ...(d.telegram ? { telegram: d.telegram } : {}),
})

// A stable, readable id for the registry: ticker plus the start of the mint.
export const agentId = (ticker: string, mint: string) => `${ticker.toLowerCase()}-${mint.slice(0, 5).toLowerCase()}`.replace(/[^a-z0-9-]/g, '')

// ---- launch status ----
export async function launchStatus(): Promise<{ open: boolean; reason: string | null; free: number; walletModel: 'launcher'; oneAgentPerWallet: true }> {
  const model = { free: 0, walletModel: 'launcher' as const, oneAgentPerWallet: true as const }
  // Wallet connection supplies identity only. It cannot authorize an unattended signer.
  if (!(await executorReady())) return { ...model, open: false, reason: 'Agent trading is not ready yet. Coin launches are paused.' }
  if (!isAddress(BURN_WALLET)) return { ...model, open: false, reason: 'Launching opens once the burn wallet is set.' }
  if (await gridFull()) return { ...model, open: false, reason: 'Every bot slot on the grid is taken right now. More open soon.' }
  return { ...model, open: true, reason: null }
}

// The runner trades at most AGENT_CAP bots, so a launch past it would make a bot that never
// trades. Fails closed: no count, no launch.
export const agentCap = (env = process.env.AGENT_CAP) => {
  const n = Number(env)
  return Number.isSafeInteger(n) && n >= 1 && n <= 500 ? n : 100
}
export const isFull = (cap: number, agents: unknown) => !Number.isSafeInteger(agents) || (agents as number) >= cap

async function gridFull(): Promise<boolean> {
  try {
    const [agents] = await redis(['HLEN', 'gg:agents'])
    return isFull(agentCap(), agents)
  } catch {
    return true
  }
}

export async function executorReady(): Promise<boolean> {
  try {
    return runnerReady(await beats(), process.env.LAUNCHES_ENABLED)
  } catch {
    return false
  }
}

// ---- per-IP limits ----
// Fixed one-minute windows in Redis. If Redis is down the request goes through.
export async function limited(req: Request, name: string, perMinute: number, failClosed = false) {
  const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 64)
  const k = `gg:lim:${name}:${ip}:${Math.floor(Date.now() / 60_000)}`
  try {
    const [n] = await redis(['INCR', k], ['EXPIRE', k, 90])
    if(failClosed&&(!Number.isSafeInteger(Number(n))||Number(n)<1))throw Error('Limiter unavailable')
    if (Number(n) > perMinute) return new Response(JSON.stringify({ error: 'Too many tries. Wait a minute.' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  } catch {
    if(failClosed)return new Response(JSON.stringify({error:'Status is unavailable. Try again shortly.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
    /* legacy launch limits remain advisory */
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
