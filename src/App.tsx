import { lazy, Suspense, useEffect, useState } from 'react'
import { MAIN_MINT, MAIN_NAME, MAIN_TICKER, X_HANDLE, buyUrl } from './config'
import { stats, useFeed } from './data/useFeed'
import type { View } from './scene/Scene'
import { pct } from './lib/format'
import { BotMark } from './ui/BotMark'
import { CallCard } from './ui/CallCard'
import { CallsPanel, DocsPanel, GridPanel, StatsPanel } from './ui/Panels'
import { MatrixPanel } from './ui/Matrix'
import { useAgents } from './data/useAgents'
import { seenTour, Tour } from './ui/Tour'
import './app.css'

const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

type Tab = 'desk' | 'calls' | 'stats' | 'matrix' | 'grid' | 'docs'
const TABS: Tab[] = ['desk', 'calls', 'stats', 'matrix', 'grid', 'docs']

export default function App() {
  const feed = useFeed()
  const [view, setView] = useState<View>('third')
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1) as Tab
    return TABS.includes(h) ? h : 'desk'
  })
  const s = stats(feed)
  const grid = useAgents(tab === 'matrix')
  const [touring, setTouring] = useState(() => !seenTour())

  useEffect(() => {
    history.replaceState(null, '', tab === 'desk' ? location.pathname : `#${tab}`)
  }, [tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'Escape') {
        setTab('desk')
        setView('third')
      }
      if (e.key === '1') setView('third')
      if (e.key === '2') setView('phone')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app ${tab !== 'desk' ? 'has-panel' : ''}`}>
      <div className="stage">
        <Suspense fallback={<Boot />}>
          <Scene feed={feed} view={view} />
        </Suspense>
      </div>

      <header className="bar">
        <button className="brand" onClick={() => { setTab('desk'); setView('third') }}>
          <BotMark size={30} />
          <span>GrokGrid</span>
        </button>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="bar-right">
          <span className={`status mono ${feed.mode}`}>
            <i />
            {feed.mode === 'live' ? 'live' : 'demo'}
          </span>
          {X_HANDLE && (
            <a className="chip mono" href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer">@{X_HANDLE}</a>
          )}
          <BuyButton />
        </div>
      </header>

      <section className="calls-dock" aria-label="latest calls">
        {feed.calls.slice(0, 2).map((c, i) => (
          <div key={c.id} className={`dock-card ${i ? 'older' : ''}`}>
            <CallCard call={c} compact />
          </div>
        ))}
      </section>

      <div className="views" role="tablist" aria-label="camera">
        <button role="tab" aria-selected={view === 'third'} className={view === 'third' ? 'on' : ''} onClick={() => setView('third')}>
          third person <kbd>1</kbd>
        </button>
        <button role="tab" aria-selected={view === 'phone'} className={view === 'phone' ? 'on' : ''} onClick={() => setView('phone')}>
          his phone <kbd>2</kbd>
        </button>
      </div>

      <dl className="strip mono">
        <div><dt>wallet</dt><dd>{s.solNow.toFixed(2)} SOL</dd></div>
        <div><dt>24h</dt><dd className={s.pnl24h >= 0 ? 'gain' : 'loss'}>{pct(s.pnl24h)}</dd></div>
        <div><dt>trades</dt><dd>{s.trades}</dd></div>
        <div><dt>win</dt><dd>{s.winRate.toFixed(0)}%</dd></div>
      </dl>

      <aside className={`panel ${tab === 'matrix' ? 'wide' : ''}`} aria-hidden={tab === 'desk'}>
        <button className="panel-x" onClick={() => setTab('desk')} aria-label="close">×</button>
        {tab === 'calls' && <CallsPanel feed={feed} />}
        {tab === 'stats' && <StatsPanel feed={feed} />}
        {tab === 'matrix' && <MatrixPanel grid={grid} feed={feed} />}
        {tab === 'grid' && <GridPanel />}
        {tab === 'docs' && <DocsPanel onTour={() => setTouring(true)} />}
      </aside>

      {touring && (
        <Tour
          go={(t, v) => {
            setTab(t)
            setView(v)
          }}
          onDone={() => setTouring(false)}
        />
      )}

      <footer className="fine mono">{MAIN_NAME} · ${MAIN_TICKER} · unofficial fan project, not affiliated with xAI or pump.fun</footer>
    </div>
  )
}

function BuyButton() {
  const [copied, setCopied] = useState(false)
  if (!MAIN_MINT) return <span className="buy off">${MAIN_TICKER} not live yet</span>
  return (
    <span className="buy-group">
      <button
        className="ca mono"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(MAIN_MINT)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          } catch {
            prompt('Contract address', MAIN_MINT)
          }
        }}
      >
        {copied ? 'copied' : `${MAIN_MINT.slice(0, 4)}…${MAIN_MINT.slice(-4)}`}
      </button>
      <a className="buy" href={buyUrl()} target="_blank" rel="noreferrer">Buy ${MAIN_TICKER}</a>
    </span>
  )
}

function Boot() {
  return (
    <div className="boot">
      <BotMark size={64} />
      <span className="mono">waking him up</span>
    </div>
  )
}
