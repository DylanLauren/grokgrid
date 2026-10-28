export const usd = (n: number | null) => {
  if (n === null || !Number.isFinite(n)) return '–'
  const a = Math.abs(n)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(1)}K` : `$${a.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}
export const signedUsd = (n: number | null) => n === null || !Number.isFinite(n) ? '–' : (n >= 0 ? `+${usd(n)}` : usd(n))
export const mc = (n: number | null) => n === null || !Number.isFinite(n) ? '–' : (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${(n / 1e3).toFixed(1)}K`)
export const pct = (n: number | null) => n === null || !Number.isFinite(n) ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`)
export const ago = (ts: number, now = Date.now()) => {
  const s = Math.max(1, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
export const short = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a)
