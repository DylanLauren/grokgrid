import { balances, hasStore, HOUSE_WALLET, json, parse, redis, solUsd, toHash } from './_lib.js'

// The house bot's calls and wallet curve. Answers mode "demo" until Grok Bot has
// posted its first trade, and the site plays the labelled demo story instead.
export async function GET() {
  if (!hasStore()) return json({ mode: 'demo' })
  const [calls, curve, stats] = await redis(['LRANGE', 'gg:calls:house', 0, 199], ['LRANGE', 'gg:curve:house', -500, -1], ['HGETALL', 'gg:stats:house'])
  const list = ((calls as string[]) ?? []).map((c) => parse(c)).filter(Boolean)
  if (!list.length) return json({ mode: 'demo' })

  const points = ((curve as string[]) ?? []).map((p) => parse<{ ts: number; sol: number }>(p)).filter((p): p is { ts: number; sol: number } => !!p)
  // the last point always comes from the chain, not from the bot
  const [bal, price] = await Promise.all([HOUSE_WALLET ? balances([HOUSE_WALLET]) : Promise.resolve({} as Record<string, number>), solUsd()])
  if (HOUSE_WALLET && bal[HOUSE_WALLET] !== undefined) points.push({ ts: Date.now(), sol: bal[HOUSE_WALLET] })
  if (!points.length) points.push({ ts: Date.now(), sol: 0 })

  const h = toHash(stats)
  return json({
    mode: 'live',
    wallet: HOUSE_WALLET || null,
    solUsd: price,
    calls: list,
    curve: points,
    burnedMain: Number(h.burnedMain ?? 0),
    feesSol: Number(h.feesSol ?? 0),
  })
}
