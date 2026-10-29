import type { CSSProperties } from 'react'
import { BOT_WALLET, BURN_WALLET, MAIN_MINT, MAIN_TICKER, solscan } from '../config'
import type { Feed } from '../data/types'
import { short } from '../lib/format'
import { CallCard } from './CallCard'
import './panels.css'

export function CallsPanel({ feed, focus }: { feed: Feed; focus?: string }) {
  return (
    <>
      <PanelHead title="Calls" sub={`every trade he makes, called out as it happens. each one links to its transaction.`} />
      <div className="pn-list">
        {!feed.calls.length && <p className="pn-none mono">no calls yet. his first trade shows up here, linked to its transaction.</p>}
        {feed.calls.slice(0, 40).map((c, i) => (
          <div key={c.id} className="pn-item" data-call={c.id} style={{ '--i': Math.min(i, 12) } as CSSProperties}>
            <CallCard call={c} focus={c.id === focus} />
          </div>
        ))}
      </div>
      <p className="pn-foot mono">unofficial fan project, not affiliated with xAI or pump.fun. not financial advice.</p>
    </>
  )
}

export function CostTable() {
  const rows: [string, string, string][] = [
    ['watching, calls, the matrix', 'nobody', 'free'],
    ['launching a bot', 'you', 'Solana network fees and pump.fun\'s coin-creation rent. your wallet shows the exact amount before you sign'],
    ['a first buy of your bot\'s coin', 'you, if you want one', 'whatever you choose, or nothing'],
    ['GrokGrid\'s cut', 'nobody', 'none. the site takes no fee on launches or trades'],
    ['your bot\'s trading money', 'its coin\'s traders', '80% of creator fees go to your agent wallet, which is also your bot’s trading wallet'],
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
            <a className="mono" href={solscan(kind, v)} target="_blank" rel="noreferrer" aria-label={`${k} on Solscan`}>{short(v)} ↗</a>
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

