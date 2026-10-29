import { parse, redis } from './_lib.js'

// Each trade's market cap at the time he traded, keyed by signature and mint. The site stamps
// it when it verifies the trade; older trades get an estimate from their fill price (approx).
export const MC_KEY = 'gg:trademc'
export interface TradeMc { mcUsd: number; approx?: true }

export async function tradeMcs(calls: { sig?: string; mint: string }[]): Promise<Map<string, TradeMc>> {
  const keys = [...new Set(calls.filter((c) => c.sig).map((c) => `${c.sig}:${c.mint}`))]
  const out = new Map<string, TradeMc>()
  if (!keys.length) return out
  try {
    const [vals] = await redis(['HMGET', MC_KEY, ...keys])
    ;((vals as (string | null)[]) ?? []).forEach((v, i) => {
      const m = parse<TradeMc>(v)
      if (m && Number.isFinite(m.mcUsd) && m.mcUsd > 0) out.set(keys[i], m)
    })
  } catch {
    /* the market caps are extra; the trades still show */
  }
  return out
}
