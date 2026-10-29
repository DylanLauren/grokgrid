import { beats, fresh } from './_heartbeat.js'
import { chainCurve } from './_curve.js'
import { curveFrom, tally } from './_tally.js'
import { balances, hasStore, HOUSE_WALLET, json, MAIN_MINT, markets, parse, redis, solUsd, toHash } from './_lib.js'
import { tradeMcs } from './_trademc.js'

// Registry entry, written once by /api/ingest when Grok Bot launches an agent's coin.
export interface AgentRecord {
  id: string
  name: string
  color: string
  shape: string
  strategy: string
  launchedAt: number
  wallet: string
  owner?: string // the wallet that launched it
  rules?: { maxSol: number; takeProfit: number; stopLoss: number } // how its owner asked it to trade
  coin: { mint: string; symbol: string; name: string; image?: string; hue: string }
  privyWalletId?: string // the verified Privy wallet the agent runner signs from
}

interface CallLite { mint: string; image?: string; hue?: string; name?: string; side: 'buy' | 'sell'; symbol: string; spentSol: number; sizeTokens?: number; pnlUsd: number | null; ts: number; sig?: string }

const RECENT = 12 // trades per bot on the matrix; the profile gets the whole history
const MAX_MINTS = 90 // traded coins looked up per request (three DexScreener batches)

// Every bot on the grid with its coin attached: registry from the store,
// balances from the chain, market data from DexScreener. `only` (an id or a coin mint)
// returns just that bot with its whole trade history and wallet curve.
export async function grid(only?: string) {
  const [reg] = await redis(['HGETALL', 'gg:agents'])
  const all = Object.values(toHash(reg))
    .map((v) => parse<AgentRecord>(v))
    .filter((a): a is AgentRecord => !!a)
  const records = only ? all.filter((r) => r.id === only || r.coin.mint === only) : all
  const withHouse = !only || only === 'house' || (!!MAIN_MINT && only === MAIN_MINT)
  const ids = [...(withHouse ? ['house'] : []), ...records.map((r) => r.id)]
  if (!ids.length) return null

  const per = await redis(...ids.flatMap((id) => [['HGETALL', `gg:stats:${id}`], ['LRANGE', `gg:calls:${id}`, 0, only ? 199 : 99], ...(only ? [['LRANGE', `gg:curve:${id}`, -300, -1]] : [])]))
  const step = only ? 3 : 2
  const callsOf = ids.map((_, i) => (Array.isArray(per[i * step + 1]) ? (per[i * step + 1] as unknown[]) : []).map((c) => parse<CallLite>(c)).filter((c): c is CallLite => !!c && !!c.mint))
  const shown = callsOf.map((c) => (only ? c : c.slice(0, RECENT)))
  const traded = [...new Set(shown.flat().map((c) => c.mint))].slice(0, MAX_MINTS)
  // a profile also gets its wallet history as the chain recorded it
  const chains = only ? Promise.all(ids.map((id, i) => chainCurve(id, i === 0 && withHouse ? HOUSE_WALLET : records[i - (withHouse ? 1 : 0)].wallet))) : Promise.resolve([])
  const [bal, mkt, price, beat, chain, mcs] = await Promise.all([
    balances([...(withHouse ? [HOUSE_WALLET] : []), ...records.map((r) => r.wallet)]),
    markets([MAIN_MINT, ...records.map((r) => r.coin.mint), ...traded]),
    solUsd(),
    beats().then((b) => b.trading).catch(() => undefined),
    chains,
    tradeMcs(shown.flat()),
  ])
  const houseMode = fresh(beat) ? beat.mode : null

  const houseRecord: AgentRecord = {
    id: 'house',
    name: 'House Trader',
    color: '#ffffff',
    shape: 'sphere',
    strategy: houseMode === 'execute' ? 'the house bot. trading on his own, inside hard limits' : houseMode === 'paper' ? 'the house bot. paper trading: real signals, simulated fills' : 'the house bot. wallet monitoring is active; automatic trading is paused',
    launchedAt: 0,
    wallet: HOUSE_WALLET,
    coin: { mint: MAIN_MINT, symbol: process.env.VITE_MAIN_TICKER || 'GRID', name: 'Grok Grid', image: '/favicon.svg', hue: '#f4f4f2' },
  }

  // privyWalletId stays server-side: the runner gets it from the authenticated launch outbox.
  const agents = [...(withHouse ? [houseRecord] : []), ...records].map(({ privyWalletId: _pw, ...r }, i) => {
    const st = toHash(per[i * step])
    const calls = callsOf[i]
    const t = tally(calls)
    const m = mkt[r.coin.mint]
    const trade = (c: CallLite) => {
      const tok = mkt[c.mint]
      const p = t.pnl.get(c)
      return {
        mint: c.mint, side: c.side, sig: c.sig, ts: c.ts,
        symbol: tok?.symbol || c.symbol, name: tok?.name || c.name || '', image: tok?.image || c.image, hue: c.hue || r.color,
        tradeMc: mcs.get(`${c.sig}:${c.mint}`)?.mcUsd, tradeMcApprox: mcs.get(`${c.sig}:${c.mint}`)?.approx,
        spentSol: c.spentSol, sizeTokens: c.sizeTokens, pnlUsd: c.pnlUsd ?? (p === undefined ? null : p * price), pnlSol: p ?? null,
        coin: tok ? { mcUsd: tok.mcUsd, vol24hUsd: tok.vol24hUsd, change24h: tok.change24h } : undefined,
      }
    }
    const recent = shown[i].map(trade)
    const posted = only ? ((per[i * step + 2] as unknown[]) ?? []).map((p) => parse<{ ts: number; sol: number }>(p)).filter((p): p is { ts: number; sol: number } => !!p) : undefined
    // no snapshots posted: rebuild the history from its own verified trades
    const onChain = chain[i]?.map(({ ts, sol }) => ({ ts, sol }))
    const base = onChain?.length ? onChain : posted
    const curve = base && base.length < 2 && bal[r.wallet] !== undefined ? curveFrom(calls, bal[r.wallet]) : base && onChain?.length && bal[r.wallet] !== undefined ? [...base, { ts: Date.now(), sol: bal[r.wallet] }] : base
    return {
      ...r,
      house: r.id === 'house' || undefined,
      launchedAt: r.launchedAt || Number(st.firstTs ?? calls.at(-1)?.ts ?? Date.now()),
      coin: {
        ...r.coin,
        symbol: m?.symbol || r.coin.symbol,
        name: m?.name || r.coin.name,
        image: m?.image || r.coin.image,
        mcUsd: m?.mcUsd ?? 0,
        vol24hUsd: m?.vol24hUsd ?? 0,
        change24h: m?.change24h ?? 0,
        feesSol: Number(st.feesSol ?? 0),
        real: !!r.coin.mint,
      },
      walletSol: bal[r.wallet] ?? 0,
      pnlSol: t.pnlSol,
      closed: t.closed,
      trades: Math.max(Number(st.trades ?? 0), calls.length),
      winRate: t.winRate,
      burnedMain: Number(st.burnedMain ?? 0),
      last: recent[0],
      recent,
      ...(curve ? { curve } : {}),
    }
  })
  return { agents, records, price, solUsd: price }
}

export async function GET() {
  if (!hasStore()) return json({ mode: 'demo' })
  const g = await grid()
  if (!g) return json({ mode: 'demo' })
  const { agents, records, price } = g
  const live = records.length > 0 || agents[0].trades > 0
  return json({ mode: live ? 'live' : 'demo', updatedAt: Date.now(), solUsd: price, agents })
}
