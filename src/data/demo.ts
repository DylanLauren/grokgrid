import type { Call, Feed, WalletPoint } from './types'

import snapshot from './tokenSnapshot.json'
import type { RealCoin } from './types'

// Real token identities and market snapshots; positions and trades are simulations.
const COINS: RealCoin[] = snapshot.coins

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

export function makeCall(r: () => number, ts: number, i: number, solUsd: number, coins: RealCoin[] = COINS): Call {
  const c = coins[Math.floor(r() * coins.length)]
  const side = r() < 0.55 ? 'buy' : 'sell'
  const spentSol = +(0.1 + r() * 0.4).toFixed(2)
  const marketMc = c.mcUsd
  const move = side === 'buy' ? (r() - 0.5) * 0.08 : (r() - 0.56) * 0.9
  const entryMc = marketMc / (1 + move)
  const nowMc = marketMc
  const positionUsd = spentSol * solUsd * (1 + move)
  const pnlUsd = positionUsd - spentSol * solUsd
  const pct = `${Math.abs(move * 100).toFixed(0)}%`
  const pool = side === 'buy' ? BUY_NOTES : move >= 0 ? WIN_NOTES : LOSS_NOTES
  return {
    id: `demo-${ts}-${i}`,
    ts,
    side,
    mint: c.mint,
    image: c.image,
    sample: true,
    symbol: c.symbol,
    name: c.name,
    hue: '#1683ff',
    note: fill(pool[Math.floor(r() * pool.length)], c.symbol, entryMc, pct),
    sizeTokens: Math.round((spentSol * solUsd / entryMc) * 1e9),
    spentSol,
    positionUsd,
    pnlUsd,
    entryMc,
    nowMc,
  }
}

export function demoFeed(now = Date.now(), coins: RealCoin[] = COINS): Feed {
  const solUsd = 182
  const r = rng(Math.floor(now / 3.6e6)) // same story for everyone within the hour
  const calls: Call[] = []
  let ts = now - 6 * 3.6e6
  let i = 0
  while (ts < now - 20000) {
    calls.push(makeCall(r, ts, i++, solUsd, coins))
    ts += 6 * 60e3 + r() * 14 * 60e3
  }
  calls.reverse()
  const curve: WalletPoint[] = []
  let sol = 2
  for (let t = now - 6 * 3.6e6; t <= now; t += 5 * 60e3) {
    sol = Math.max(0.2, sol * (1 + (r() - 0.53) * 0.04))
    curve.push({ ts: t, sol })
  }
  return { mode: 'demo', marketUpdatedAt: snapshot.updatedAt, wallet: null, solUsd, calls, curve, burnedMain: 0, feesSol: 0 }
}
