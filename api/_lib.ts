// Shared helpers for the site's functions. Public data only: no function here
// holds or asks for a private key. Grok Bot signs its own trades elsewhere.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || ''
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ''
const HELIUS = process.env.HELIUS_API_KEY || ''
export const RPC = HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
export const HOUSE_WALLET = process.env.VITE_BOT_WALLET || ''
export const MAIN_MINT = process.env.VITE_MAIN_MINT || ''
const SOL_MINT = 'So11111111111111111111111111111111111111112'

export const hasStore = () => !!(REDIS_URL && REDIS_TOKEN)

// Runs Redis commands in one round trip through Upstash's REST pipeline.
export async function redis(...cmds: (string | number)[][]): Promise<unknown[]> {
  if (!hasStore()) return cmds.map(() => null)
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  })
  if (!res.ok) throw new Error(`redis ${res.status}`)
  const out = (await res.json()) as { result?: unknown; error?: string }[]
  return out.map((r) => (r.error ? null : r.result))
}

export const parse = <T>(s: unknown): T | null => {
  try {
    return typeof s === 'string' ? (JSON.parse(s) as T) : null
  } catch {
    return null
  }
}

export const json = (body: unknown, status = 200, maxAge = 5) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}` : 'no-store',
    },
  })

export const isAddress = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)
export const isSig = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s)

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const j = (await res.json()) as { result?: T }
    return j.result ?? null
  } catch {
    return null
  }
}

// SOL balances straight from the chain, so the site never trusts a reported number.
export async function balances(wallets: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const list = wallets.filter(isAddress)
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    const r = await rpc<{ value: ({ lamports: number } | null)[] }>('getMultipleAccounts', [chunk, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])
    r?.value.forEach((acc, j) => (out[chunk[j]] = (acc?.lamports ?? 0) / 1e9))
  }
  return out
}

// True when the signature exists on chain, succeeded, and was signed by the wallet.
export async function signedBy(sig: string, wallet: string): Promise<boolean> {
  const tx = await rpc<{ meta: { err: unknown } | null; transaction: { message: { accountKeys: { pubkey: string; signer: boolean }[] } } }>('getTransaction', [
    sig,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ])
  if (!tx || tx.meta?.err) return false
  return tx.transaction.message.accountKeys.some((k) => k.signer && k.pubkey === wallet)
}

export interface Market { mcUsd: number; vol24hUsd: number; change24h: number; image?: string }

// Market data for up to 30 coins per call from DexScreener, picking each coin's deepest pair.
export async function markets(mints: string[]): Promise<Record<string, Market>> {
  const out: Record<string, Market> = {}
  const list = [...new Set(mints.filter(isAddress))]
  for (let i = 0; i < list.length; i += 30) {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${list.slice(i, i + 30).join(',')}`)
      if (!res.ok) continue
      const pairs = (await res.json()) as {
        baseToken: { address: string }
        marketCap?: number
        fdv?: number
        volume?: { h24?: number }
        priceChange?: { h24?: number }
        liquidity?: { usd?: number }
        info?: { imageUrl?: string }
      }[]
      const best: Record<string, (typeof pairs)[number]> = {}
      for (const p of pairs) {
        const a = p.baseToken.address
        if (!best[a] || (p.liquidity?.usd ?? 0) > (best[a].liquidity?.usd ?? 0)) best[a] = p
      }
      for (const [a, p] of Object.entries(best)) {
        out[a] = { mcUsd: p.marketCap ?? p.fdv ?? 0, vol24hUsd: p.volume?.h24 ?? 0, change24h: p.priceChange?.h24 ?? 0, image: p.info?.imageUrl }
      }
    } catch {
      /* one bad batch should not blank the page */
    }
  }
  return out
}

export async function solUsd(): Promise<number> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`)
    const j = (await res.json()) as Record<string, { usdPrice?: number }>
    return j[SOL_MINT]?.usdPrice || 180
  } catch {
    return 180
  }
}

// Upstash returns HGETALL as a flat [field, value, ...] list
export function toHash(r: unknown): Record<string, string> {
  const a = (r as string[]) ?? []
  const o: Record<string, string> = {}
  for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]
  return o
}
