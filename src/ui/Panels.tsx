import { useEffect, useMemo, useState } from 'react'
import { BOT_WALLET, BURN_WALLET, MAIN_MINT, MAIN_TICKER, solscan } from '../config'
import type { Feed } from '../data/types'
import { stats } from '../data/useFeed'
import { pct, short, signedUsd, usd } from '../lib/format'
import { BotMark, FAMILY } from './BotMark'
import { CallCard } from './CallCard'
import './panels.css'

export function CallsPanel({ feed }: { feed: Feed }) {
  return (
    <>
      <PanelHead title="Calls" sub={`every trade he makes, called out as it happens. ${feed.mode === 'demo' ? 'demo until his wallet goes live.' : 'each one links to its transaction.'}`} />
      <div className="pn-list">
        {feed.calls.slice(0, 40).map((c) => (
          <CallCard key={c.id} call={c} />
        ))}
      </div>
    </>
  )
}

export function StatsPanel({ feed }: { feed: Feed }) {
  const s = stats(feed)
  const tiles: [string, string, string?][] = [
    ['wallet', `${s.solNow.toFixed(3)} SOL`, usd(s.usdNow)],
    ['p&l 1h', pct(s.pnl1h), s.pnl1h >= 0 ? 'gain' : 'loss'],
    ['p&l 24h', pct(s.pnl24h), s.pnl24h >= 0 ? 'gain' : 'loss'],
    ['p&l all', pct(s.pnlAll), s.pnlAll >= 0 ? 'gain' : 'loss'],
    ['trades', `${s.trades}`],
    ['win rate', `${s.winRate.toFixed(0)}%`],
    ['fees in', `${feed.feesSol.toFixed(2)} SOL`],
    [`$${MAIN_TICKER} burned`, feed.burnedMain ? feed.burnedMain.toLocaleString() : '0'],
  ]
  return (
    <>
      <PanelHead title="Stats" sub={feed.mode === 'demo' ? 'demo numbers. the real ones are read from his wallet on chain once it is live.' : 'read from his wallet on chain, not from us.'} />
      <div className="pn-tiles">
        {tiles.map(([k, v, extra], i) => (
          <div className="pn-tile" key={k}>
            <span className="mono pn-idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="pn-k">{k}</span>
            <b className={extra === 'gain' || extra === 'loss' ? extra : ''}>{v}</b>
            {extra && extra !== 'gain' && extra !== 'loss' && <span className="pn-x mono">{extra}</span>}
          </div>
        ))}
      </div>
      <div className="pn-pair">
        {s.best && (
          <div className="pn-tile">
            <span className="pn-k">best trade</span>
            <b className="gain">{signedUsd(s.best.pnlUsd)}</b>
            <span className="pn-x mono">{s.best.symbol}</span>
          </div>
        )}
        {s.worst && (
          <div className="pn-tile">
            <span className="pn-k">worst trade</span>
            <b className="loss">{signedUsd(s.worst.pnlUsd)}</b>
            <span className="pn-x mono">{s.worst.symbol}</span>
          </div>
        )}
      </div>
      <Addresses />
    </>
  )
}

const DRAFT_KEY = 'gg-bot-draft'

export function GridPanel() {
  const [draft, setDraft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '') as { look: number; name: string; persona: string }
    } catch {
      return { look: 3, name: '', persona: '' }
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      /* private mode */
    }
  }, [draft])
  const ready = false // the launch flow opens after the main coin is live
  const look = FAMILY[draft.look]

  return (
    <>
      <PanelHead title="The grid" sub={`every bot is a coin. 80% of its fees fund its trades, 20% buy and burn $${MAIN_TICKER}.`} />
      <div className="pn-family">
        {FAMILY.map((f, i) => (
          <button key={f.name} className={`pn-swatch ${i === draft.look ? 'on' : ''}`} onClick={() => setDraft({ ...draft, look: i })} aria-label={`${f.name} bot`}>
            <BotMark size={40} color={f.color} shape={f.shape} />
          </button>
        ))}
      </div>
      <div className="pn-form">
        <div className="pn-preview">
          <BotMark size={92} color={look.color} shape={look.shape} />
          <div>
            <b>{draft.name || 'your bot'}</b>
            <span>{draft.persona || 'one line on how it trades'}</span>
          </div>
        </div>
        <label>
          <span>name</span>
          <input maxLength={32} value={draft.name} placeholder="e.g. night shift" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          <span>how it trades</span>
          <input maxLength={120} value={draft.persona} placeholder="e.g. only buys coins under 30K, sells at 2x" onChange={(e) => setDraft({ ...draft, persona: e.target.value })} />
        </label>
        <div className="pn-split mono">
          <span>creator fees</span>
          <span>80% its trading wallet</span>
          <span>20% buys and burns ${MAIN_TICKER}</span>
        </div>
        <button className="pn-launch" disabled={!ready}>Launch bot</button>
        <p className="pn-ready">
          {ready ? 'one wallet approval. the coin and the fee split go live together.' : `launching opens once $${MAIN_TICKER} is live. your draft is saved in this tab.`}
        </p>
      </div>
      <div className="pn-empty">
        <BotMark size={26} />
        <span>no user bots yet. the first ones will line up here, ranked by profit.</span>
      </div>
    </>
  )
}

export function DocsPanel() {
  const flow = useMemo(() => <FlowDiagram />, [])
  return (
    <>
      <PanelHead title="Docs" sub="what he is, how he trades, where the money goes, and who holds which keys." />
      <article className="pn-doc">
        <h3>what he is</h3>
        <p>A Grok Bot with his own phone, his own wallet and the pump.fun app. He sits at this desk, reads charts, trades, and tells you about every trade the moment he makes it, here and on X. He wins some and he loses some. You see both.</p>
        <h3>how he trades</h3>
        <p>He is a Grok Bot, xAI's agent with its own cloud computer. His wallet lives there and he trades pump.fun from that machine. Grok decides what to buy and sell, reads the trader lists and calls on X for ideas, and writes each callout in its own words. Every trade he posts here carries its transaction signature, and the site checks that signature on chain before marking it verified. His phone in the room redraws his screen from those trades.</p>
        <h3>where the money goes</h3>
        {flow}
        <p>Creator fees from ${MAIN_TICKER} split two ways. 80% goes to the treasury, which runs his trading wallet and creates new grid bots and their wallets. 20% buys ${MAIN_TICKER} on the market and burns it. Every grid bot is its own coin. Its creator fees split the same way as ${MAIN_TICKER}'s: 80% to its trading wallet and 20% to a wallet that buys ${MAIN_TICKER} on the market and burns it. The split is written into each coin when it is created, by pump.fun's own fee sharing, so nobody can change it later.</p>
        <h3>a worked example</h3>
        <p>A grid bot's coin trades 100 SOL in a day. Its creator fees are paid in SOL. 80% goes to the bot to trade with. The other 20% buys ${MAIN_TICKER} and burns it. Ten busy bots means ten small buys of ${MAIN_TICKER} every day, forever, without anyone deciding to do it.</p>
        <h3>who can take my money</h3>
        <p>Nobody can take coins out of your wallet. Launching a bot is one transaction you sign yourself. Trading wallets for the house bot and for grid bots are held by Grok Bot, so the trading share of each bot's fees sits in those wallets, in the open, at the addresses below. Each wallet only ever holds its own trading budget. The burn wallet only ever buys and burns.</p>
        <h3>what if this site goes down</h3>
        <p>The coins, the fee split and every trade live on Solana, not here. The site is a window. If it closes, the chain still has all of it.</p>
        <h3>under the hood</h3>
        <Addresses />
        <p className="pn-fine">GrokGrid is an unofficial fan project. It is not made by, endorsed by or connected to xAI, X or pump.fun. Memecoins can go to zero. Nothing here is financial advice.</p>
      </article>
    </>
  )
}

function Addresses() {
  const rows: [string, string, 'account' | 'token'][] = [
    [`$${MAIN_TICKER} mint`, MAIN_MINT, 'token'],
    ['his wallet', BOT_WALLET, 'account'],
    ['burn wallet', BURN_WALLET, 'account'],
  ]
  return (
    <div className="pn-addr">
      {rows.map(([k, v, kind]) => (
        <div key={k}>
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

function FlowDiagram() {
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
