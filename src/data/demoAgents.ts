import type { Agent, AgentsFeed } from './types'

// Demo grid, shown only until the first real agent launches. Labelled "demo"
// everywhere it appears; none of these bots or coins exist.
const BOTS: [string, string, Agent['shape'], string, string][] = [
  ['dip goblin', '#0b0b0b', 'sphere', 'buys the first red candle after a fresh ATH, sells the bounce', 'GOBL'],
  ['tangerine', '#ff6a00', 'sphere', 'only trades coins under 30K with a real X account', 'TNGR'],
  ['cloudy', '#ff9a00', 'cloud', 'follows the wallets that called the last three runners', 'CLDY'],
  ['tealtime', '#13b8a6', 'squircle', 'scalps volume spikes, never holds past ten minutes', 'TEAL'],
  ['vio', '#9b5cff', 'tile', 'reads the trenches list and fades whatever everyone is calling', 'VIO'],
  ['bluechip', '#1683ff', 'squircle', 'slow. buys coins over 1M that held their base for a day', 'BLUE'],
  ['pinky', '#ff2e9a', 'cone', 'apes every cat coin. that is the whole strategy', 'PNKY'],
  ['drizzle', '#7a7a7a', 'drop', 'small size, many entries, cuts losers at minus 20%', 'DRZL'],
  ['toast', '#9a6a3f', 'sphere', 'buys coins with food in the name. sells at 2x', 'TOST'],
]

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const addr = (r: () => number, end = '') => {
  const abc = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 44 - end.length; i++) s += abc[Math.floor(r() * abc.length)]
  return s + end
}

export function demoAgents(now = Date.now()): AgentsFeed {
  const r = rng(20261028)
  const agents: Agent[] = BOTS.map(([name, color, shape, strategy, symbol], i) => {
    const mcUsd = 9000 + r() ** 2 * 900000
    const trades = 4 + Math.floor(r() * 160)
    return {
      id: `demo-${i}`,
      name,
      color,
      shape,
      strategy,
      launchedAt: now - (1 + r() * 9) * 8.64e7,
      wallet: addr(r),
      coin: {
        mint: addr(r, 'pump'),
        symbol,
        name,
        hue: color,
        mcUsd,
        vol24hUsd: mcUsd * (0.3 + r() * 2.5),
        change24h: (r() - 0.45) * 120,
        feesSol: (mcUsd / 1e5) * (0.4 + r()),
      },
      walletSol: 0.2 + r() * 6,
      pnlSol: (r() - 0.42) * 4,
      trades,
      winRate: 25 + r() * 45,
      burnedMain: Math.round(r() * 3e6),
      last: {
        side: r() < 0.5 ? 'buy' : 'sell',
        symbol: ['MOTH', 'GLUE', 'FERN', 'HONK', 'ZAPP', 'SOUP'][Math.floor(r() * 6)],
        spentSol: +(0.05 + r() * 0.5).toFixed(2),
        pnlUsd: (r() - 0.45) * 60,
        ts: now - r() * 40 * 60e3,
      },
    }
  })
  return { mode: 'demo', updatedAt: now, solUsd: 182, agents }
}

// Nudges the demo numbers so the page moves the way the live one will.
export function driftAgents(feed: AgentsFeed, now = Date.now()): AgentsFeed {
  const r = Math.random
  return {
    ...feed,
    updatedAt: now,
    agents: feed.agents.map((a) => {
      const k = 1 + (r() - 0.48) * 0.03
      const traded = r() < 0.12
      return {
        ...a,
        coin: { ...a.coin, mcUsd: a.coin.mcUsd * k, vol24hUsd: a.coin.vol24hUsd + a.coin.mcUsd * r() * 0.004, change24h: a.coin.change24h + (k - 1) * 100, feesSol: a.coin.feesSol + r() * 0.002 },
        trades: a.trades + (traded ? 1 : 0),
        walletSol: Math.max(0.05, a.walletSol + (traded ? (r() - 0.48) * 0.1 : 0)),
        last: traded ? { side: r() < 0.5 ? 'buy' : 'sell', symbol: a.last?.symbol ?? 'MOTH', spentSol: +(0.05 + r() * 0.4).toFixed(2), pnlUsd: (r() - 0.45) * 40, ts: now } : a.last,
      }
    }),
  }
}
