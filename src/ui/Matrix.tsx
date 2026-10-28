import { useEffect, useMemo, useRef, useState } from 'react'
import { BOT_WALLET, MAIN_MINT, MAIN_NAME, MAIN_TICKER, solscan } from '../config'
import type { Agent, AgentsFeed, Feed } from '../data/types'
import { stats } from '../data/useFeed'
import { ago, mc, pct, short, signedUsd, usd } from '../lib/format'
import { LiveBot, type Habit } from './LiveBot'
import { CoinChip } from './CoinChip'
import './matrix.css'

type Sort = 'mc' | 'volume' | 'change' | 'pnl' | 'newest'
const SORTS: [Sort, string][] = [
  ['mc', 'market cap'],
  ['volume', '24h volume'],
  ['change', '24h move'],
  ['pnl', 'bot p&l'],
  ['newest', 'newest'],
]
const by: Record<Sort, (a: Agent) => number> = {
  mc: (a) => a.coin.mcUsd,
  volume: (a) => a.coin.vol24hUsd,
  change: (a) => a.coin.change24h,
  pnl: (a) => a.pnlSol,
  newest: (a) => a.launchedAt,
}

// The house bot sits on row zero. When the API has not sent it yet, build it from his own feed.
function houseRow(feed: Feed): Agent {
  const s = stats(feed)
  const last = feed.calls[0]
  return {
    id: 'house',
    house: true,
    name: 'grok grid',
    color: '#ffffff',
    shape: 'sphere',
    strategy: 'the house bot. trades on his phone at the desk, funds every bot below',
    launchedAt: feed.curve[0]?.ts ?? Date.now(),
    wallet: BOT_WALLET,
    coin: { mint: MAIN_MINT, symbol: MAIN_TICKER, name: MAIN_NAME, image: '/favicon.svg', hue: '#f4f4f2', mcUsd: 0, vol24hUsd: 0, change24h: 0, feesSol: feed.feesSol },
    walletSol: s.solNow,
    pnlSol: s.solNow - (feed.curve[0]?.sol ?? s.solNow),
    trades: s.trades,
    winRate: s.winRate,
    burnedMain: feed.burnedMain,
    last: last && { side: last.side, symbol: last.symbol, spentSol: last.spentSol, pnlUsd: last.pnlUsd, ts: last.ts, sig: last.sig, mint: last.mint, image: last.image, hue: last.hue },
  }
}

export function MatrixPanel({ grid, feed }: { grid: AgentsFeed; feed: Feed }) {
  const [sort, setSort] = useState<Sort>('mc')
  const now = useNow()
  const house = grid.agents.find((a) => a.house) ?? houseRow(feed)
  const rows = useMemo(() => grid.agents.filter((a) => !a.house).sort((a, b) => by[sort](b) - by[sort](a)), [grid, sort])
  const all = [house, ...rows]
  const sum = (f: (a: Agent) => number) => all.reduce((n, a) => n + f(a), 0)

  const totals: [string, string][] = [
    ['bots trading', `${all.length}`],
    ['combined mc', mc(sum((a) => a.coin.mcUsd))],
    ['24h volume', mc(sum((a) => a.coin.vol24hUsd))],
    ['fees earned', `${sum((a) => a.coin.feesSol).toFixed(2)} SOL`],
    [`$${MAIN_TICKER} burned`, compact(sum((a) => a.burnedMain))],
  ]

  return (
    <div className="mx">
      <dl className="mx-totals">
        {totals.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mx-sort" role="tablist" aria-label="sort">
        {SORTS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="mx-table" role="table">
        <div className="mx-row mx-th mono" role="row">
          <span>#</span>
          <span>bot</span>
          <span>coin</span>
          <span className="r">mc</span>
          <span className="r">24h vol</span>
          <span className="r">24h</span>
          <span className="r">fees</span>
          <span className="r">wallet</span>
          <span className="r">p&l</span>
          <span className="r">trades</span>
          <span>last trade</span>
          <span />
        </div>
        {all.map((a, i) => (
          <Row key={a.id} a={a} i={i} solUsd={grid.solUsd} now={now} />
        ))}
      </div>
      {grid.mode === 'demo' && <p className="mx-fine">sample bots on real pump.fun coins: real coin identities and pictures; market snapshots refresh every minute. bot trades, wallets, fees and performance are simulated. market snapshot: {grid.marketUpdatedAt ? new Date(grid.marketUpdatedAt).toLocaleString() : 'unavailable'}. real bots replace them when they launch.</p>}
    </div>
  )
}

const HABITS: Habit[] = ['look', 'bounce', 'float', 'sway', 'tilt', 'flip', 'hop', 'squish', 'doze']

function Row({ a, i, solUsd, now }: { a: Agent; i: number; solUsd: number; now: number }) {
  const live = !!a.coin.mint && (a.coin.real || !a.id.startsWith('demo'))
  return (
    <div className={`mx-row ${a.house ? 'house' : ''}`} role="row">
      <span className="mx-i mono">{a.house ? '00' : String(i).padStart(2, '0')}</span>
      <span className="mx-bot">
        <span className="mx-face">
          <LiveBot size={34} color={a.house ? 'house' : a.color} eye={a.house ? '#0a0a0a' : '#fff'} shape={a.shape} habit={a.house ? 'look' : HABITS[i % HABITS.length]} delay={i * -0.6} />
        </span>
        <span>
          <b>{a.name}</b>
          <small>{a.strategy}</small>
        </span>
      </span>
      <span className="mx-coin">
        <CoinChip call={{ hue: a.coin.hue, image: a.coin.image, symbol: a.coin.symbol }} size={30} />
        <span>
          <b>${a.coin.symbol}</b>
          <small className="mono">{a.coin.mint ? <Copy text={a.coin.mint} /> : 'not live yet'}</small>
        </span>
      </span>
      <Num className="r" v={a.coin.mcUsd} label="mc">{a.coin.mcUsd ? mc(a.coin.mcUsd) : '–'}</Num>
      <Num className="r" v={a.coin.vol24hUsd} label="24h vol">{a.coin.vol24hUsd ? mc(a.coin.vol24hUsd) : '–'}</Num>
      <Num className={`r ${a.coin.change24h >= 0 ? 'gain' : 'loss'}`} v={a.coin.change24h} label="24h">{a.coin.mcUsd ? pct(a.coin.change24h) : '–'}</Num>
      <Num className="r" v={a.coin.feesSol} label="fees"><Sol n={a.coin.feesSol} /></Num>
      <Num className="r" v={a.walletSol} label="wallet"><Sol n={a.walletSol} /></Num>
      <Num className={`r ${a.pnlSol >= 0 ? 'gain' : 'loss'}`} v={a.pnlSol} label="p&l" title={usd(a.pnlSol * solUsd)}>
        {a.pnlSol >= 0 ? '+' : ''}{a.pnlSol.toFixed(2)}
      </Num>
      <span className="r mono" data-label="trades">
        {a.trades}
        <small> · {a.winRate.toFixed(0)}%</small>
      </span>
      <span className="mx-last mono" data-label="last trade">
        {a.last ? (
          <>
            {a.last.image && <CoinChip call={{ image: a.last.image, symbol: a.last.symbol, hue: a.last.hue ?? a.color }} size={20} />}
            <em className={a.last.side}>{a.last.side}</em> {a.last.symbol}{' '}
            {a.last.side === 'sell' ? <span className={a.last.pnlUsd >= 0 ? 'gain' : 'loss'}>{signedUsd(a.last.pnlUsd)}</span> : `${a.last.spentSol} SOL`}
            <small> {ago(a.last.ts, now)}</small>
          </>
        ) : (
          '–'
        )}
      </span>
      <span className="mx-links">
        {live && (
          <a href={`https://pump.fun/coin/${a.coin.mint}`} target="_blank" rel="noreferrer" aria-label={`$${a.coin.symbol} on pump.fun`} title="pump.fun">
            <img src="/brands/pumpfun.svg" alt="" width={18} height={18} />
          </a>
        )}
        {a.wallet && !a.id.startsWith('demo') && (
          <a href={solscan('account', a.wallet)} target="_blank" rel="noreferrer" title="bot wallet on Solscan" aria-label={`${a.name} wallet on Solscan`}>
            <img src="/brands/solana.svg" alt="" width={14} height={14} />
          </a>
        )}
      </span>
    </div>
  )
}

// A number cell that flashes green or red when its value moves.
function Num({ v, className = '', label, title, children }: { v: number; className?: string; label: string; title?: string; children: React.ReactNode }) {
  const prev = useRef(v)
  const [dir, setDir] = useState<'' | 'up' | 'down'>('')
  useEffect(() => {
    if (v === prev.current) return
    setDir(v > prev.current ? 'up' : 'down')
    prev.current = v
    const t = setTimeout(() => setDir(''), 900)
    return () => clearTimeout(t)
  }, [v])
  return (
    <span className={`mono ${className} ${dir && `flash-${dir}`}`} data-label={label} title={title}>
      {children}
    </span>
  )
}

function Sol({ n }: { n: number }) {
  return (
    <span className="mx-num">
      {n.toFixed(2)}
      <img className="mx-sol" src="/brands/solana.svg" alt="SOL" width={10} height={10} />
    </span>
  )
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="mx-copy"
      title="copy contract address"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          prompt('Contract address', text)
        }
      }}
    >
      {done ? 'copied' : short(text)}
    </button>
  )
}

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`)
