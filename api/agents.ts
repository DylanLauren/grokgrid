import { balances, hasStore, HOUSE_WALLET, json, MAIN_MINT, markets, parse, redis, solUsd, toHash } from './_lib.js'

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
}

interface CallLite { mint?: string; image?: string; hue?: string; side: 'buy' | 'sell'; symbol: string; spentSol: number; pnlUsd: number; ts: number; sig?: string }

// Every bot on the grid with its coin attached: registry from the store,
// balances from the chain, market data from DexScreener.
export async function GET() {
  if (!hasStore()) return json({ mode: 'demo' })
  const [reg] = await redis(['HGETALL', 'gg:agents'])
  const records = Object.values(toHash(reg))
    .map((v) => parse<AgentRecord>(v))
    .filter((a): a is AgentRecord => !!a)
  const ids = ['house', ...records.map((r) => r.id)]

  const perAgent = await redis(...ids.flatMap((id) => [['HGETALL', `gg:stats:${id}`], ['LINDEX', `gg:calls:${id}`, 0]]))
  const lastCalls = ids.map((_, i) => parse<CallLite>(perAgent[i * 2 + 1]))
  const [bal, mkt, price] = await Promise.all([
    balances([HOUSE_WALLET, ...records.map((r) => r.wallet)]),
    markets([MAIN_MINT, ...records.map((r) => r.coin.mint), ...lastCalls.flatMap((c) => c?.mint ? [c.mint] : [])]),
    solUsd(),
  ])

  const houseRecord: AgentRecord = {
    id: 'house',
    name: 'grok grid',
    color: '#ffffff',
    shape: 'sphere',
    strategy: 'the house bot. trades on his phone at the desk, funds every bot below',
    launchedAt: 0,
    wallet: HOUSE_WALLET,
    coin: { mint: MAIN_MINT, symbol: process.env.VITE_MAIN_TICKER || 'GRID', name: 'Grok Grid', image: '/favicon.svg', hue: '#f4f4f2' },
  }

  const agents = [houseRecord, ...records].map((r, i) => {
    const st = toHash(perAgent[i * 2])
    const last = lastCalls[i]
    const lastToken = last?.mint ? mkt[last.mint] : undefined
    const m = mkt[r.coin.mint]
    return {
      ...r,
      house: r.id === 'house' || undefined,
      launchedAt: r.launchedAt || Number(st.firstTs ?? Date.now()),
      coin: {
        ...r.coin,
        symbol: m?.symbol || r.coin.symbol,
        name: m?.name || r.coin.name,
        image: m?.image || r.coin.image,
        mcUsd: m?.mcUsd ?? 0,
        vol24hUsd: m?.vol24hUsd ?? 0,
        change24h: m?.change24h ?? 0,
        feesSol: Number(st.feesSol ?? 0),
      },
      walletSol: bal[r.wallet] ?? 0,
      pnlSol: null,
      trades: Number(st.trades ?? 0),
      winRate: null,
      burnedMain: Number(st.burnedMain ?? 0),
      last: last ? { mint: last.mint, image: lastToken?.image || last.image, hue: last.hue || r.color, side: last.side, symbol: lastToken?.symbol || last.symbol, spentSol: last.spentSol, pnlUsd: last.pnlUsd, ts: last.ts, sig: last.sig } : undefined,
    }
  })

  const live = records.length > 0 || Number(toHash(perAgent[0]).trades ?? 0) > 0
  return json({ mode: live ? 'live' : 'demo', updatedAt: Date.now(), solUsd: price, agents })
}
