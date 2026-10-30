import { isAddress, parse, redis, rpc } from './_lib.js'

// A bot's wallet history read straight from the chain: every transaction that touched the
// wallet, with the balance it left behind. Deposits and withdrawals show as the steps they
// are, so the chart never pretends a top-up was a trade. Each sync reads only what is new
// since the last one and keeps it in Redis; one sync runs at a time per wallet.
export interface Point { ts: number; sol: number; sig?: string }

const KEEP = 500
const PER_SYNC = 40 // transactions read per sync; a long backlog fills in over a few
const LOCK_S = 15

interface Sig { signature: string; blockTime?: number | null }
interface Tx {
  blockTime?: number | null
  meta?: { postBalances?: number[]; loadedAddresses?: { writable?: string[]; readonly?: string[] } } | null
  transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } }
}

/** The wallet's history, oldest first. Returns null when the chain or store can't be read. */
export async function chainCurve(id: string, wallet: string): Promise<Point[] | null> {
  if (!isAddress(wallet)) return null
  const key = `gg:chaincurve:${id}`
  try {
    const [got] = await redis(['SET', `${key}:lock`, '1', 'NX', 'EX', LOCK_S])
    if (got === 'OK') await sync(key, wallet)
    const [list] = await redis(['LRANGE', key, -KEEP, -1])
    const pts = ((list as string[]) ?? []).map((p) => parse<Point>(p)).filter((p): p is Point => !!p && Number.isFinite(p.ts) && Number.isFinite(p.sol))
    return pts.length ? pts : null
  } catch {
    return null
  }
}

async function sync(key: string, wallet: string) {
  const [last, owner] = await redis(['GET', `${key}:last`], ['GET', `${key}:wallet`])
  // a bot that moved to a new wallet starts its history over
  const fresh = owner !== wallet
  const until = fresh ? undefined : (last as string | null) || undefined
  const sigs = await rpc<Sig[]>('getSignaturesForAddress', [wallet, { limit: 1000, commitment: 'confirmed', ...(until ? { until } : {}) }])
  if (!sigs?.length) {
    if (fresh) await redis(['DEL', key], ['SET', `${key}:wallet`, wallet])
    return
  }
  // newest first from the chain; read the oldest unread ones first
  const batch = sigs.slice(-PER_SYNC).reverse()
  const txs = await Promise.all(batch.map((s) => rpc<Tx>('getTransaction', [s.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }])))
  const pts: Point[] = []
  for (let i = 0; i < batch.length; i++) {
    const tx = txs[i]
    if (!tx) break // stop at the first one we couldn't read and pick it up next time
    // balances follow the message keys, then any keys loaded from lookup tables
    const keys = [...(tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === 'string' ? k : k.pubkey)), ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])]
    const at = keys.indexOf(wallet)
    const lamports = at >= 0 ? tx.meta?.postBalances?.[at] : undefined
    const ts = (tx.blockTime ?? batch[i].blockTime ?? 0) * 1000
    if (lamports !== undefined && ts) pts.push({ ts, sol: lamports / 1e9, sig: batch[i].signature })
  }
  const read = txs.findIndex((t) => !t)
  const done = read < 0 ? batch.length : read
  if (!done) return
  const cmds: (string | number)[][] = []
  if (fresh) cmds.push(['DEL', key], ['SET', `${key}:wallet`, wallet])
  if (pts.length) cmds.push(['RPUSH', key, ...pts.map((p) => JSON.stringify(p))], ['LTRIM', key, -KEEP, -1])
  cmds.push(['SET', `${key}:last`, batch[done - 1].signature])
  await redis(...cmds)
}
