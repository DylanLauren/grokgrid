import { tally } from './_tally.js'
import { balances, hasStore, HOUSE_WALLET, json, markets, parse, redis, solUsd, toHash } from './_lib.js'

// The house bot's calls and wallet curve. Answers mode "demo" until Grok Bot has
// posted its first trade, and the site plays the labelled demo story instead.
export async function GET() {
  if (!hasStore()) return json({ mode: 'demo' })
  const [calls, curve, stats] = await redis(['LRANGE', 'gg:calls:house', 0, 199], ['LRANGE', 'gg:curve:house', -500, -1], ['HGETALL', 'gg:stats:house'])
  const list = ((calls as string[]) ?? []).map((c) => parse<{ mint: string; symbol: string; name: string; image?: string; side: 'buy' | 'sell'; spentSol: number; sizeTokens?: number; ts: number }>(c)).filter((c): c is NonNullable<typeof c> => !!c)
  if (!list.length) return json({ mode: 'demo' })

  const points = ((curve as string[]) ?? []).map((p) => parse<{ ts: number; sol: number }>(p)).filter((p): p is { ts: number; sol: number } => !!p)
  // the last point always comes from the chain, not from the bot
  const [bal, price] = await Promise.all([HOUSE_WALLET ? balances([HOUSE_WALLET]) : Promise.resolve({} as Record<string, number>), solUsd()])
  if (HOUSE_WALLET && bal[HOUSE_WALLET] !== undefined) points.push({ ts: Date.now(), sol: bal[HOUSE_WALLET] })
  if (!points.length) points.push({ ts: Date.now(), sol: 0 })

  const metadata = await markets(list.map((call) => call.mint))
  // realised SOL on each sell, from the verified buys before it (pnlUsd stays as recorded)
  const t = tally(list)
  const h = toHash(stats)
  return json({
    mode: 'live',
    wallet: HOUSE_WALLET || null,
    solUsd: price,
    calls: list.map((c) => {
      const call = t.pnl.has(c) ? { ...c, pnlSol: t.pnl.get(c) } : c
      const token = metadata[c.mint]
      return token ? { ...call, symbol: token.symbol || call.symbol, name: token.name || call.name, image: token.image || call.image } : call
    }),
    curve: points,
    burnedMain: Number(h.burnedMain ?? 0),
    feesSol: Number(h.feesSol ?? 0),
  })
}
