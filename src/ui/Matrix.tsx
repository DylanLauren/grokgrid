import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BOT_WALLET, MAIN_MINT, MAIN_NAME, MAIN_TICKER, solscan } from '../config'
import type { Agent, AgentsFeed, BotTrade, Feed } from '../data/types'
import { stats } from '../data/useFeed'
import { ago, compact, mc, short, sol, usd } from '../lib/format'
import { LiveBot, type Habit } from './LiveBot'
import { CoinChip } from './CoinChip'
import { peek, PeekLayer, type PeekCoin } from './CoinPeek'
import { atMc, avgMcs, avgRows, dur, type AvgMc, type Round } from './BestWorst'
import './matrix.css'

type Sort = 'mc' | 'newest'
const SORTS: [Sort, string][] = [
  ['mc', 'tokens & grok bots'],
  ['newest', 'newest'],
]
const by: Record<Sort, (a: Agent) => number> = {
  mc: (a) => a.coin.mcUsd,
  newest: (a) => a.launchedAt,
}

// The house bot sits on row zero. When the API has not sent it yet, build it from his own feed.
export function houseRow(feed: Feed): Agent {
  const s = stats(feed)
  const last = feed.calls[0]
  return {
    id: 'house',
    house: true,
    name: 'House Trader',
    color: '#ffffff',
    shape: 'sphere',
    strategy: 'the house bot. trades the $GRID treasury from his phone, nothing else',
    launchedAt: feed.curve[0]?.ts ?? Date.now(),
    wallet: BOT_WALLET,
    coin: { mint: MAIN_MINT, symbol: MAIN_TICKER, name: MAIN_NAME, image: '/favicon.svg', hue: '#f4f4f2', mcUsd: 0, vol24hUsd: 0, change24h: 0, feesSol: feed.feesSol },
    walletSol: s.solNow,
    pnlSol: feed.mode === 'demo' ? s.solNow - (feed.curve[0]?.sol ?? s.solNow) : null,
    trades: s.trades,
    winRate: s.winRate,
    burnedMain: feed.burnedMain,
    last: last && { side: last.side, symbol: last.symbol, spentSol: last.spentSol, pnlUsd: last.pnlUsd, ts: last.ts, sig: last.sig, mint: last.mint, image: last.image, hue: last.hue },
    recent: feed.calls.slice(0, 12).map((c) => ({ mint: c.mint, side: c.side, sig: c.sig, ts: c.ts, symbol: c.symbol, name: c.name, image: c.image, hue: c.hue, spentSol: c.spentSol, pnlUsd: c.pnlUsd, pnlSol: c.pnlSol ?? null, coin: c.nowMc ? { mcUsd: c.nowMc, vol24hUsd: 0, change24h: 0 } : undefined })),
  }
}

// What the floating card shows for a bot's own coin, and for a coin it traded.
export function ownCoin(a: Agent): PeekCoin {
  const live = !!a.coin.mint && !a.id.startsWith('demo')
  return {
    symbol: a.coin.symbol, name: a.coin.name, image: a.coin.image, hue: a.coin.hue,
    tag: a.house ? 'his coin' : `${a.name}'s coin`,
    ...(a.coin.mint ? { mcUsd: a.coin.mcUsd, vol24hUsd: a.coin.vol24hUsd, change24h: a.coin.change24h } : {}),
    rows: a.coin.mint
      ? [
          ['creator fees', live ? `${a.coin.feesSol.toFixed(3)} SOL` : '–'],
          [`$${MAIN_TICKER} burned`, live ? compact(a.burnedMain) : '–'],
          ['contract', short(a.coin.mint)],
        ]
      : [['status', 'not minted yet']],
  }
}

export function tradeCoin(t: BotTrade, now: number, solUsd: number, avg?: AvgMc, round?: Round): PeekCoin {
  const pnl = t.pnlSol ?? (t.pnlUsd !== null ? t.pnlUsd / solUsd : null)
  return {
    symbol: t.symbol, name: t.name, image: t.image, hue: t.hue ?? '#5a5a66',
    tag: `${t.side === 'buy' ? 'bought' : 'sold'} ${ago(t.ts, now)}`,
    ...(t.coin ?? {}),
    rows: [
      [t.side === 'buy' ? 'spent' : 'got back', `${t.spentSol.toFixed(4)} SOL`],
      ...(t.side === 'sell' && round?.buy ? [['bought at', `${atMc(round.buy)} mc`] as [string, string]] : []),
      [t.side === 'buy' ? 'bought at' : 'sold at', `${atMc(t)} mc`],
      ...avgRows(avg),
      ...(t.side === 'sell' ? [['realised', pnl === null ? '–' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL${round ? ` (${round.pct >= 0 ? '+' : ''}${round.pct.toFixed(1)}%)` : ''}`, pnl === null ? '' : pnl >= 0 ? 'gain' : 'loss'] as [string, string, string]] : []),
      ...(round?.held != null ? [['held', dur(round.held)] as [string, string]] : []),
    ],
  }
}

export function MatrixPanel({ grid, feed, onOpen }: { grid: AgentsFeed; feed: Feed; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<Sort>('mc')
  const now = useNow()
  const house = grid.agents.find((a) => a.house) ?? houseRow(feed)
  const rows = useMemo(() => grid.agents.filter((a) => !a.house).sort((a, b) => by[sort](b) - by[sort](a)), [grid, sort])
  const all = [house, ...rows]
  const sum = (f: (a: Agent) => number) => all.reduce((n, a) => n + f(a), 0)

  const totals: [string, string][] = [
    ['bots trading', `${all.length}`],
    ['combined mc', mc(sum((a) => a.coin.mcUsd))],
    // sample bots never earned fees or burned anything: show those only once the grid is live
    ['fees earned', grid.mode === 'live' ? `${sum((a) => a.coin.feesSol).toFixed(2)} SOL` : '–'],
    [`$${MAIN_TICKER} burned`, grid.mode === 'live' ? compact(sum((a) => a.burnedMain)) : '–'],
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

      <div className="mx-sort" role="group" aria-label="sort">
        {SORTS.map(([k, label]) => (
          <button key={k} aria-pressed={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
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
          <span className="r">fees</span>
          <span className="r">wallet</span>
          <span className="r">p&l</span>
          <span className="r">trades</span>
          <span>recent</span>
          <span />
        </div>
        {all.map((a, i) => (
          <Row key={a.id} a={a} i={i} solUsd={grid.solUsd} now={now} onOpen={onOpen} />
        ))}
      </div>
      <PeekLayer />
      {grid.mode === 'demo' && <p className="mx-fine">sample bots on real pump.fun coins: real coin identities and pictures; market snapshots refresh every minute. bot trades, wallets, fees and performance are simulated, and these coins have nothing to do with GrokGrid. market snapshot: {grid.marketUpdatedAt ? new Date(grid.marketUpdatedAt).toLocaleString() : 'unavailable'}. real bots replace them when they launch.</p>}
    </div>
  )
}

const HABITS: Habit[] = ['look', 'bounce', 'float', 'sway', 'tilt', 'flip', 'hop', 'squish', 'doze']

function Row({ a, i, solUsd, now, onOpen }: { a: Agent; i: number; solUsd: number; now: number; onOpen: (id: string) => void }) {
  const sample = a.id.startsWith('demo')
  const live = !!a.coin.mint && !sample
  return (
    <div
      className={`mx-row ${a.house ? 'house' : ''}`}
      role="row"
      tabIndex={0}
      aria-label={`open ${a.name}'s profile`}
      style={{ '--r': Math.min(i, 16) } as CSSProperties}
      // the whole row opens the bot; its own links and buttons keep their click
      onClick={(e) => !(e.target as Element).closest('a, button') && onOpen(a.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(a.id)}
    >
      <span className="mx-i mono">{a.house ? '00' : String(i).padStart(2, '0')}</span>
      <span className="mx-bot">
        <span className="mx-face">
          <LiveBot size={34} color={a.house ? 'house' : a.color} shape={a.shape} habit={a.house ? 'look' : HABITS[i % HABITS.length]} delay={i * -0.6} />
        </span>
        <span>
          <b>{a.name}{sample && <em className="mx-sample mono">sample</em>}</b>
          <small>{a.strategy}</small>
        </span>
      </span>
      <span className="mx-coin">
        <span className="mx-peek" {...peek(ownCoin(a))}>
          <CoinChip call={{ hue: a.coin.hue, image: a.coin.image, symbol: a.coin.symbol }} size={30} />
        </span>
        <span>
          <b>${a.coin.symbol}</b>
          <small className="mono">{a.coin.mint ? <Copy text={a.coin.mint} /> : 'not live yet'}</small>
        </span>
      </span>
      <Num className="r" v={a.coin.mcUsd} label="mc">{a.coin.mcUsd ? mc(a.coin.mcUsd) : '–'}</Num>
      <Num className="r" v={a.coin.feesSol} label="fees">{sample ? '–' : <Sol n={a.coin.feesSol} />}</Num>
      <Num className="r" v={a.walletSol} label="wallet"><Sol n={a.walletSol} /></Num>
      <Num className={`r ${a.pnlSol === null ? 'dim' : a.pnlSol >= 0 ? 'gain' : 'loss'}`} v={a.pnlSol ?? 0} label="p&l" title={a.pnlSol === null ? 'Cost basis not verified' : usd(a.pnlSol * solUsd)}>
        {a.pnlSol === null ? '–' : `${a.pnlSol >= 0 ? '+' : ''}${sol(a.pnlSol)}`}
      </Num>
      <span className="r mono" data-label="trades">
        {a.trades}
        <small> · {(a.winRate === null ? '–' : a.winRate.toFixed(0))}%</small>
      </span>
      <span className="mx-last" data-label="recent">
        <Strip a={a} now={now} solUsd={solUsd} />
      </span>
      <span className="mx-links">
        {live && (
          <a href={`https://pump.fun/coin/${a.coin.mint}`} target="_blank" rel="noreferrer" aria-label={`$${a.coin.symbol} on pump.fun`} title="pump.fun">
            <img src="/brands/pumpfun.svg" alt="" width={18} height={18} />
          </a>
        )}
        {a.wallet && !sample && (
          <a href={solscan('account', a.wallet)} target="_blank" rel="noreferrer" title="bot wallet on Solscan" aria-label={`${a.name} wallet on Solscan`}>
            <img src="/brands/solana.svg" alt="" width={14} height={14} />
          </a>
        )}
      </span>
    </div>
  )
}

// His latest trades as a row of coins, newest first. Each coin opens its card on hover.
function Strip({ a, now, solUsd }: { a: Agent; now: number; solUsd: number }) {
  const list = a.recent?.length ? a.recent : a.last?.mint ? [{ ...a.last, mint: a.last.mint, name: '', pnlSol: null } as BotTrade] : []
  if (!list.length) return <span className="mx-none mono">no trades yet</span>
  const shown = list.slice(0, 5)
  const avg = avgMcs(list)
  return (
    <span className="mx-strip">
      {shown.map((t, k) => (
        <span key={`${t.sig ?? t.ts}-${t.side}`} className={`mx-tr ${t.side}`} style={{ '--k': k } as CSSProperties} {...peek(tradeCoin(t, now, solUsd, avg.get(t.mint)))}>
          <CoinChip call={{ image: t.image, symbol: t.symbol, hue: t.hue ?? a.color }} size={24} />
          <i />
        </span>
      ))}
      <small className="mono">{ago(list[0].ts, now)}</small>
    </span>
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
      {sol(n)}
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

