import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { solscan } from '../config'
import type { Agent, AgentsFeed, BotTrade, Feed, WalletPoint } from '../data/types'
import { ago, compact, mc, pct, short, usd } from '../lib/format'
import { CoinChip } from '../ui/CoinChip'
import { peek, PeekLayer } from '../ui/CoinPeek'
import { BestWorst, rounds } from '../ui/BestWorst'
import { positions, Positions } from '../ui/Positions'
import { houseRow, tradeCoin } from '../ui/Matrix'
import { Page } from './Page'
import './botpage.css'

// One bot, everything at once: its coin, its wallet, how it is doing and every trade.
// Opened from a matrix row, or straight from a coin's pump.fun website link
// (grokgrid.fun/#matrix/<mint>), so `which` is a bot id or its coin's mint.
export function BotPage({ which, grid, feed, onBack }: { which: string; grid: AgentsFeed; feed: Feed; onBack: () => void }) {
  const now = useNow()
  const fromGrid = grid.agents.find((a) => a.id === which || (!!a.coin.mint && a.coin.mint === which)) ?? (which === 'house' ? houseRow(feed) : undefined)
  const [full, setFull] = useState<{ key: string; agent: Agent } | null>(null)
  const [missing, setMissing] = useState(false)

  // the matrix row is shown at once; the whole history follows and refreshes every 10s
  useEffect(() => {
    let alive = true
    setMissing(false)
    const pull = async () => {
      try {
        const res = await fetch(`/api/bot?id=${encodeURIComponent(which)}`)
        if (res.status === 404) return alive && setMissing(true)
        if (!res.ok) return
        const body = (await res.json()) as { mode: string; agent?: Agent }
        if (alive && body.mode === 'live' && body.agent) setFull({ key: which, agent: body.agent })
      } catch {
        /* local dev without functions: the matrix row is all there is */
      }
    }
    pull()
    const t = setInterval(pull, 10_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [which])

  const a = full?.key === which ? full.agent : fromGrid
  if (!a) {
    return (
      <Page n={4} label="matrix" title="Not found" sub="no bot or coin on the grid matches this link." say="who?">
        <button className="bp-back mono" onClick={onBack}>← all bots</button>
        {!missing && <p className="mx-fine">looking it up…</p>}
      </Page>
    )
  }
  return <Profile a={a} now={now} solUsd={grid.solUsd || feed.solUsd} onBack={onBack} />
}

function Profile({ a, now, solUsd, onBack }: { a: Agent; now: number; solUsd: number; onBack: () => void }) {
  const sample = a.id.startsWith('demo')
  const trades = a.recent ?? []
  const done = useMemo(() => rounds(trades, !sample, solUsd), [trades, sample, solUsd])
  const open = useMemo(() => positions(trades, solUsd), [trades, solUsd])
  const pnl = a.pnlSol
  const tiles: [string, React.ReactNode, string?, string?][] = [
    ['wallet', <Sol n={a.walletSol} d={4} />, '', a.wallet ? short(a.wallet) : ''],
    ['realised p&l', pnl === null ? '–' : <><span>{pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}</span><small> SOL</small></>, pnl === null ? '' : pnl >= 0 ? 'gain' : 'loss', pnl === null ? 'no closed trades yet' : usd(pnl * solUsd)],
    ['win rate', a.winRate === null ? '–' : `${a.winRate.toFixed(0)}%`, '', a.closed ? `${a.closed} closed` : ''],
    ['trades', `${a.trades}`, '', a.recent?.[0] ? `last ${ago(a.recent[0].ts, now)}` : ''],
    ['creator fees', sample ? '–' : <Sol n={a.coin.feesSol} d={3} />, '', a.house ? '80% treasury · 20% burn' : '80% wallet · 20% burn'],
    ['$GRID burned', sample ? '–' : compact(a.burnedMain), '', 'from its 20%'],
  ]

  return (
    <Page
      n={4}
      label="matrix"
      title={a.name}
      sub={a.strategy}
      say={a.house ? 'this is me' : `i'm ${a.name.toLowerCase()}`}
      host={a.house ? undefined : { color: a.color, shape: a.shape }}
      side={<button className="bp-back mono" onClick={onBack}>← all bots</button>}
    >
      <div className="bp">
        <div className="bp-top">
          <div className="card bp-coin">
            <span className="st-k mono">{a.house ? 'his coin' : 'its coin'}</span>
            <div className="bp-coin-id">
              <CoinChip call={{ symbol: a.coin.symbol, image: a.coin.image, hue: a.coin.hue }} size={54} />
              <div>
                <b>${a.coin.symbol}</b>
                <span>{a.coin.name}</span>
              </div>
            </div>
            <dl className="bp-coin-stats mono">
              <div><dt>mc</dt><dd>{a.coin.mcUsd ? mc(a.coin.mcUsd) : '–'}</dd></div>
              <div><dt>24h vol</dt><dd>{a.coin.vol24hUsd ? mc(a.coin.vol24hUsd) : '–'}</dd></div>
              <div><dt>24h</dt><dd className={a.coin.mcUsd ? (a.coin.change24h >= 0 ? 'gain' : 'loss') : ''}>{a.coin.mcUsd ? pct(a.coin.change24h) : '–'}</dd></div>
            </dl>
            <div className="bp-links mono">
              {a.coin.mint ? (
                <>
                  <a href={`https://pump.fun/coin/${a.coin.mint}`} target="_blank" rel="noreferrer"><img src="/brands/pumpfun.svg" alt="" width={14} height={14} />pump.fun</a>
                  <a href={solscan('token', a.coin.mint)} target="_blank" rel="noreferrer">{short(a.coin.mint)}</a>
                </>
              ) : (
                <span className="dim">not minted yet</span>
              )}
              {a.wallet && !sample && <a href={solscan('account', a.wallet)} target="_blank" rel="noreferrer"><img src="/brands/solana.svg" alt="" width={12} height={12} />wallet</a>}
            </div>
          </div>

          <dl className="bp-tiles">
            {tiles.map(([k, v, cls, note], i) => (
              <div key={k} className="card bp-tile" style={{ '--r': i } as CSSProperties}>
                <dt className="st-k mono">{k}</dt>
                <dd className={cls}>{v}</dd>
                {note && <small className="mono">{note}</small>}
              </div>
            ))}
          </dl>
        </div>

        {a.curve && a.curve.length > 1 && <Curve points={a.curve} />}

        <section className="card bp-bw">
          <div className="bp-trades-head">
            <h2>Open positions</h2>
            <span className="mono">{open.length ? `${open.length} held · value from market cap now` : 'none right now'}</span>
          </div>
          {open.length ? <Positions open={open} solUsd={solUsd} now={now} /> : <p className="pos-empty mono">Not holding anything right now.</p>}
        </section>

        {done.length > 0 && (
          <section className="card bp-bw">
            <div className="bp-trades-head">
              <h2>Best and worst</h2>
              <span className="mono">of {done.length} closed</span>
            </div>
            <BestWorst done={done} solUsd={solUsd} />
          </section>
        )}

        <section className="bp-trades card">
          <div className="bp-trades-head">
            <h2>Trades</h2>
            <span className="mono">{trades.length ? `${trades.length} shown · newest first · every one checked on chain` : ''}</span>
          </div>
          {trades.length ? (
            <div className="bp-list" role="table">
              <div className="bp-tr bp-th mono" role="row">
                <span>coin</span>
                <span>side</span>
                <span className="r">sol</span>
                <span className="r">realised</span>
                <span className="r">mc now</span>
                <span className="r">24h</span>
                <span className="r">when</span>
                <span />
              </div>
              {trades.map((t, i) => (
                <TradeRow key={`${t.sig ?? t.ts}-${t.side}-${i}`} t={t} i={i} now={now} solUsd={solUsd} />
              ))}
            </div>
          ) : (
            <p className="bp-empty mono">{a.house ? 'his first trade shows up here the moment it lands.' : 'no trades yet. its first one shows up here the moment it lands.'}</p>
          )}
        </section>
      </div>
      <PeekLayer />
    </Page>
  )
}

function TradeRow({ t, i, now, solUsd }: { t: BotTrade; i: number; now: number; solUsd: number }) {
  const pnl = t.pnlSol ?? (t.pnlUsd !== null ? t.pnlUsd / solUsd : null)
  return (
    <div className="bp-tr" role="row" style={{ '--r': Math.min(i, 20) } as CSSProperties}>
      <span className="bp-tr-coin" {...peek(tradeCoin(t, now, solUsd))}>
        <CoinChip call={{ symbol: t.symbol, image: t.image, hue: t.hue ?? '#5a5a66' }} size={28} />
        <span>
          <b>${t.symbol}</b>
          <small>{t.name}</small>
        </span>
      </span>
      <span><em className={`bp-side mono ${t.side}`}>{t.side}</em></span>
      <span className="r mono">{t.spentSol.toFixed(4)}</span>
      <span className={`r mono ${pnl === null ? 'dim' : pnl >= 0 ? 'gain' : 'loss'}`}>{t.side === 'sell' && pnl !== null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)}` : '–'}</span>
      <span className="r mono">{t.coin?.mcUsd ? mc(t.coin.mcUsd) : '–'}</span>
      <span className={`r mono ${t.coin?.mcUsd ? (t.coin.change24h >= 0 ? 'gain' : 'loss') : 'dim'}`}>{t.coin?.mcUsd ? pct(t.coin.change24h) : '–'}</span>
      <span className="r mono dim">{ago(t.ts, now)}</span>
      <span className="r">
        {t.sig && (
          <a className="bp-tx mono" href={solscan('tx', t.sig)} target="_blank" rel="noreferrer" aria-label="transaction on Solscan">tx ↗</a>
        )}
      </span>
    </div>
  )
}

// His wallet over time, drawn as one line.
function Curve({ points }: { points: WalletPoint[] }) {
  const path = useMemo(() => {
    const xs = points.map((p) => p.ts), ys = points.map((p) => p.sol)
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const sx = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * 1000
    const sy = (y: number) => 110 - ((y - y0) / Math.max(1e-9, y1 - y0)) * 100
    return points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.ts).toFixed(1)} ${sy(p.sol).toFixed(1)}`).join(' ')
  }, [points])
  const first = points[0].sol, last = points.at(-1)!.sol
  return (
    <div className="card bp-curve">
      <div className="bp-trades-head">
        <h2>Wallet</h2>
        <span className={`mono ${last >= first ? 'gain' : 'loss'}`}>{first.toFixed(4)} → {last.toFixed(4)} SOL</span>
      </div>
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden>
        <path d={path} pathLength={1} />
      </svg>
    </div>
  )
}

function Sol({ n, d = 2 }: { n: number; d?: number }) {
  return (
    <span className="mx-num">
      {n.toFixed(d)}
      <img className="mx-sol" src="/brands/solana.svg" alt="SOL" width={12} height={12} />
    </span>
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
