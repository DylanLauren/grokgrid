import type { Call, Feed, WalletPoint } from './types'

// Demo mode runs only while no worker is posting real trades. Every screen that shows
// these numbers carries a "demo" label, and none of these coins exist.
const COINS = [
  { symbol: 'MOTH', name: 'moth to a chart', hue: '#ff9a00' },
  { symbol: 'GLUE', name: 'glue hands', hue: '#13b8a6' },
  { symbol: 'PEBL', name: 'pebble', hue: '#7a7a7a' },
  { symbol: 'DRIP', name: 'drip check', hue: '#1683ff' },
  { symbol: 'FERN', name: 'fern', hue: '#4ade80' },
  { symbol: 'HONK', name: 'honk', hue: '#ff6a00' },
  { symbol: 'ZAPP', name: 'zapp', hue: '#9b5cff' },
  { symbol: 'SOUP', name: 'soup season', hue: '#ff2e9a' },
  { symbol: 'LOAF', name: 'loaf', hue: '#9a6a3f' },
]

const BUY_NOTES = [
  'small entry on {S} around {M} mc. holders look spread out, dev sold nothing yet.',
  'buying a little {S}. chart is boring in a good way.',
  'took a starter on {S} at {M}. if it loses the base i am out.',
  'aping {S} with lunch money. my phone made me do it.',
  '{S} volume woke up. in small, watching the top wallets.',
]
const WIN_NOTES = [
  'sold {S} into strength. up {P}. not greedy today.',
  'out of {S}, {P} green. the phone is warm.',
  'trimmed {S}. {P}. leaving the rest for the believers.',
]
const LOSS_NOTES = [
  'cut {S}. down {P}. i am just like you.',
  'out of {S} for {P}. the chart lied to me personally.',
  'stopped out of {S}, {P}. back to staring at the screen.',
]

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const fmtMc = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`)
const fill = (t: string, s: string, m: number, p: string) => t.replace('{S}', s).replace('{M}', fmtMc(m)).replace('{P}', p)

export function makeCall(r: () => number, ts: number, i: number, solUsd: number): Call {
  const c = COINS[Math.floor(r() * COINS.length)]
  const side = r() < 0.55 ? 'buy' : 'sell'
  const spentSol = +(0.1 + r() * 0.4).toFixed(2)
  const entryMc = 18000 + r() * 90000
  const move = side === 'buy' ? (r() - 0.5) * 0.08 : (r() - 0.56) * 0.9
  const nowMc = entryMc * (1 + move)
  const positionUsd = spentSol * solUsd * (1 + move)
  const pnlUsd = positionUsd - spentSol * solUsd
  const pct = `${Math.abs(move * 100).toFixed(0)}%`
  const pool = side === 'buy' ? BUY_NOTES : move >= 0 ? WIN_NOTES : LOSS_NOTES
  return {
    id: `demo-${ts}-${i}`,
    ts,
    side,
    mint: `DEMO${c.symbol}pump`,
    symbol: c.symbol,
    name: c.name,
    hue: c.hue,
    note: fill(pool[Math.floor(r() * pool.length)], c.symbol, entryMc, pct),
    sizeTokens: Math.round((spentSol * solUsd / entryMc) * 1e9),
    spentSol,
    positionUsd,
    pnlUsd,
    entryMc,
    nowMc,
  }
}

export function demoFeed(now = Date.now()): Feed {
  const solUsd = 182
  const r = rng(Math.floor(now / 3.6e6)) // same story for everyone within the hour
  const calls: Call[] = []
  let ts = now - 6 * 3.6e6
  let i = 0
  while (ts < now - 20000) {
    calls.push(makeCall(r, ts, i++, solUsd))
    ts += 6 * 60e3 + r() * 14 * 60e3
  }
  calls.reverse()
  const curve: WalletPoint[] = []
  let sol = 2
  for (let t = now - 6 * 3.6e6; t <= now; t += 5 * 60e3) {
    sol = Math.max(0.2, sol * (1 + (r() - 0.53) * 0.04))
    curve.push({ ts: t, sol })
  }
  return { mode: 'demo', wallet: null, solUsd, calls, curve, burnedMain: 0, feesSol: 0 }
}
