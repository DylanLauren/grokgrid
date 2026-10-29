import { useEffect, useState } from 'react'
import { MAIN_MINT } from '../config'

export interface GridToken {
  mint: string | null
  onChain: boolean
  startSupply: number
  supply: number | null
  burned: number | null
  locked: boolean | null
  market: { mcUsd: number; vol24hUsd: number; change24h: number } | null
  treasury: { wallet: string; sol: number | null } | null
  burnWallet: { wallet: string; sol: number | null } | null
  checkedAt: number
}

// $GRID's supply, burns and wallets read off the chain by /api/token, once the mint exists.
export function useToken(active: boolean): GridToken | null {
  const [token, setToken] = useState<GridToken | null>(null)
  useEffect(() => {
    if (!active || !MAIN_MINT) return
    let alive = true
    const load = () =>
      fetch('/api/token')
        .then((r) => (r.ok ? (r.json() as Promise<GridToken>) : null))
        .then((t) => alive && t?.mint === MAIN_MINT && setToken(t))
        .catch(() => {})
    load()
    const id = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [active])
  return token
}
