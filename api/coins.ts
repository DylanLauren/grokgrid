import { json, markets, readLimited } from './_lib.js'

// Real pump.fun coins with their logos and live market data, for the sample grid shown
// before the first bot launches: the coins DexScreener is boosting right now, plus a
// few long-running pump.fun coins so the list is never empty. Cached for a minute.
const STEADY = [
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // Fartcoin
  '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', // Peanut the Squirrel
  'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', // Goatseus Maximus
  'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', // Just a chill guy
]

async function boosted(): Promise<string[]> {
  const out: string[] = []
  for (const url of ['https://api.dexscreener.com/token-boosts/top/v1', 'https://api.dexscreener.com/token-boosts/latest/v1']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const list = (await res.json()) as { chainId: string; tokenAddress: string }[]
      for (const t of list) if (t.chainId === 'solana' && t.tokenAddress.endsWith('pump')) out.push(t.tokenAddress)
    } catch {
      /* fall back to the steady list */
    }
  }
  return out
}

export async function GET(req?: Request) {
  const slow = await readLimited(req, 'coins')
  if (slow) return slow
  const mints = [...new Set([...STEADY, ...(await boosted())])].slice(0, 30)
  const m = await markets(mints)
  const coins = Object.entries(m)
    .filter(([, c]) => c.image && c.symbol && c.mcUsd >= 50_000 && c.change24h > -80)
    .map(([mint, c]) => ({ mint, ...c }))
    .sort((a, b) => Number(STEADY.includes(b.mint)) - Number(STEADY.includes(a.mint)) || b.vol24hUsd - a.vol24hUsd)
    .slice(0, 12)
  return json({ coins, updatedAt: Date.now(), source: 'dexscreener' }, coins.length ? 200 : 503, 60)
}
