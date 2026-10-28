import snapshot from './tokenSnapshot.json'
import type { RealCoin } from './types'

// One shared request/cache for the grid and the house feed. Never fall back to
// invented token identities or lose good pictures during a provider outage.
let current: RealCoin[] = snapshot.coins
let fetchedAt = 0
let updatedAt = snapshot.updatedAt
export const coinUpdatedAt = () => updatedAt
let pending: Promise<RealCoin[]> | undefined
export const cachedCoins = () => current
export function realCoins(): Promise<RealCoin[]> {
  if (Date.now() - fetchedAt < 55_000) return Promise.resolve(current)
  if (pending) return pending
  pending = fetch('/api/coins', { signal: AbortSignal.timeout(10_000) })
    .then(async (res) => {
      if (!res.ok) throw new Error('Token data unavailable')
      const body = await res.json() as { coins?: RealCoin[]; updatedAt?: number }
      const coins = body.coins?.filter((c) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.mint) && c.symbol && c.name && c.image?.startsWith('https://') && Number.isFinite(c.mcUsd))
      if (!coins?.length) throw new Error('Empty token response')
      updatedAt = body.updatedAt ?? Date.now()
      current = coins
      fetchedAt = Date.now()
      return current
    })
    .catch(() => current)
    .finally(() => { pending = undefined })
  return pending
}
