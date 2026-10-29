import type { CSSProperties } from 'react'
import { BOT_WALLET, BURN_WALLET, MAIN_MINT, MAIN_TICKER, solscan } from '../config'
import type { Feed } from '../data/types'
import { short } from '../lib/format'
import { CallCard } from './CallCard'
import './panels.css'

export function CallsPanel({ feed, focus }: { feed: Feed; focus?: string }) {
  return (
    <>
      <PanelHead title="Calls" sub={`every trade he makes, called out as it happens. ${feed.mode === 'demo' ? 'sample calls until his wallet goes live.' : 'each one links to its transaction.'}`} />
      <div className="pn-list">
        {feed.calls.slice(0, 40).map((c, i) => (
          <div key={c.id} className="pn-item" data-call={c.id} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
            <CallCard call={c} focus={c.id === focus} />
          </div>
        ))}
      </div>
    </>
  )
}

export function CostTable() {
  const rows: [string, string, string][] = [
    ['watching, calls, the matrix', 'nobody', 'free'],
    ['launching a bot', 'you', 'Solana network fees and pump.fun\'s coin-creation rent. your wallet shows the exact amount before you sign'],
    ['a first buy of your bot\'s coin', 'you, if you want one', 'whatever you choose, or nothing'],
    ['GrokGrid\'s cut', 'nobody', 'none. the site takes no fee on launches or trades'],
    ['your bot\'s trading money', 'its coin\'s traders', '80% of the creator fees pump.fun pays on every trade of its coin'],
    [`$${MAIN_TICKER} burns`, 'its coin\'s traders', 'the other 20% of those fees'],
  ]
  return (
    <div className="pn-cost" role="table">
      <div className="pn-cost-row pn-cost-th mono" role="row">
        <span>what</span>
        <span>who pays</span>
        <span>how much</span>
      </div>
      {rows.map(([a, b, c]) => (
        <div className="pn-cost-row" role="row" key={a}>
          <span>{a}</span>
          <span>{b}</span>
          <span>{c}</span>
        </div>
      ))}
    </div>
  )
}

export function Addresses() {
  const rows: [string, string, 'account' | 'token'][] = [
    [`$${MAIN_TICKER} mint`, MAIN_MINT, 'token'],
    ['his wallet', BOT_WALLET, 'account'],
    ['burn wallet', BURN_WALLET, 'account'],
  ]
  return (
    <div className="addr">
      {rows.map(([k, v, kind]) => (
        <div key={k} className="card">
          <span>{k}</span>
          {v ? (
            <a className="mono" href={solscan(kind, v)} target="_blank" rel="noreferrer">{short(v)} ↗</a>
          ) : (
            <span className="mono dim">not live yet</span>
          )}
        </div>
      ))}
    </div>
  )
}

function PanelHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="pn-head">
      <h2>{title}</h2>
      <p>{sub}</p>
    </header>
  )
}

export function FlowDiagram() {
  const box = (x: number, y: number, w: number, label: string, strong = false) => (
    <g>
      <rect x={x} y={y} width={w} height={34} rx={17} fill={strong ? '#fff' : 'none'} stroke={strong ? '#fff' : 'rgba(255,255,255,.25)'} />
      <text x={x + w / 2} y={y + 21.5} textAnchor="middle" fontSize="12.5" fill={strong ? '#0a0a0a' : '#fff'} fontWeight={strong ? 600 : 450}>{label}</text>
    </g>
  )
  const line = 'rgba(255,255,255,.35)'
  return (
    <svg className="pn-flow" viewBox="0 0 380 252" role="img" aria-label="Main coin fees fund the treasury and burns, bot coin fees fund trades and burns">
      <defs>
        <marker id="pf-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={line} />
        </marker>
      </defs>
      <g fill="none" stroke={line} markerEnd="url(#pf-a)">
        <path d="M140 27H212" />
        <path d="M292 44V98" />
        <path d="M292 190V134" />
        <path d="M214 207H142" />
        <path d="M75 44V188" />
      </g>
      {box(10, 10, 130, `$${MAIN_TICKER} fees`, true)}
      {box(214, 10, 156, 'treasury')}
      {box(214, 100, 156, 'grid bot wallets')}
      {box(214, 190, 156, 'grid bot coin fees')}
      {box(10, 190, 130, 'buy and burn')}
      <g fontSize="10.5" fill="rgba(255,255,255,.55)" fontFamily="var(--mono)">
        <text x="160" y="20">80%</text>
        <text x="300" y="75">creates bots</text>
        <text x="300" y="166">80% trades</text>
        <text x="164" y="200">20%</text>
        <text x="82" y="120">20%</text>
        <text x="75" y="242" textAnchor="middle">{`burns $${MAIN_TICKER}`}</text>
      </g>
    </svg>
  )
}
