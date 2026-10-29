import { lazy, Suspense, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { MAIN_MINT, MAIN_NAME, MAIN_TICKER, X_HANDLE, buyUrl } from './config'
import { stats, useFeed } from './data/useFeed'
import type { View } from './scene/Scene'
import { pct } from './lib/format'
import { BotMark, HOUSE_EYES, type Shape } from './ui/BotMark'
import { LiveBot, type Habit } from './ui/LiveBot'
import { CallCard } from './ui/CallCard'
import { CallsPanel } from './ui/Panels'
import { useAgents } from './data/useAgents'
import { useLive } from './data/useLive'
import { seenTour, Tour } from './ui/Tour'
import { Roll } from './ui/Roll'
import { StatsPage } from './pages/StatsPage'
import { MatrixPage } from './pages/MatrixPage'
import { GridPage } from './pages/GridPage'
import { DocsPage } from './pages/DocsPage'
import './app.css'

// his family, hanging around next to the logo
const CREW: [string, Shape, Habit][] = [
  ['#ff6a00', 'sphere', 'bounce'],
  ['#13b8a6', 'squircle', 'sway'],
  ['#9b5cff', 'tile', 'tilt'],
  ['#ff2e9a', 'cone', 'hop'],
  ['#1683ff', 'squircle', 'flip'],
]

// The callout you click in the dock glides into its place in the calls panel while the
// panel slides in around it. Browsers without view transitions just open the panel.
function morphOpen(card: HTMLElement, id: string, open: () => void) {
  const start = (document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }).startViewTransition
  if (!start || matchMedia('(prefers-reduced-motion: reduce)').matches) return open()
  card.style.viewTransitionName = 'call-open'
  document.documentElement.classList.add('vt-calls')
  const vt = start.call(document, () => {
    flushSync(open)
    card.style.viewTransitionName = ''
    const target = document.querySelector<HTMLElement>(`.panel [data-call="${CSS.escape(id)}"]`)
    target?.scrollIntoView({ block: 'center', behavior: 'instant' })
    const cc = target?.querySelector<HTMLElement>('.cc')
    if (cc) cc.style.viewTransitionName = 'call-open'
  })
  vt.finished.finally(() => {
    document.documentElement.classList.remove('vt-calls')
    document.querySelectorAll<HTMLElement>('.panel .cc').forEach((el) => (el.style.viewTransitionName = ''))
  })
}

const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))

type Tab = 'desk' | 'calls' | 'stats' | 'matrix' | 'grid' | 'docs'
const TABS: Tab[] = ['desk', 'calls', 'stats', 'matrix', 'grid', 'docs']
// desk and calls live in the room; the rest are pages of their own
const ROOM: Tab[] = ['desk', 'calls']

export default function App() {
  const feed = useFeed()
  const [view, setView] = useState<View>('third')
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1) as Tab
    return TABS.includes(h) ? h : 'desk'
  })
  const s = stats(feed)
  const onPage = !ROOM.includes(tab)
  const grid = useAgents(tab === 'matrix' || tab === 'grid')
  const live = useLive(!onPage, view === 'phone', feed)
  // the first-visit tour only starts on his desk, never over a page someone linked to
  const [touring, setTouring] = useState(() => !seenTour() && !location.hash.slice(1))
  const tucked = useTuck()
  const [focusCall, setFocusCall] = useState<string>()

  // a plain click outside an open panel closes it and puts you back in the room
  useEffect(() => {
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return // a drag, not a click
      down = null
      const t = e.target as Element
      if (t.closest('.bar, .mini, .tour, .panel, .views, .calls-dock, .strip, .page, .ph-wrap, .watch')) return
      if (tab === 'calls') {
        setTab('desk')
        setFocusCall(undefined)
      }
      else if (view === 'phone') setView('third')
    }
    addEventListener('pointerdown', onDown)
    addEventListener('pointerup', onUp)
    return () => {
      removeEventListener('pointerdown', onDown)
      removeEventListener('pointerup', onUp)
    }
  }, [tab, view])

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
      if (e.key === '2') { setTab('desk'); setFocusCall(undefined); setView('phone') }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app ${tab === 'calls' ? 'has-panel' : ''} ${onPage ? 'on-page' : ''} view-${view}`}>
      <div className="stage" aria-hidden={onPage}>
        <Suspense fallback={<Boot />}>
          <Scene feed={feed} live={live} view={view} paused={onPage} onPhone={() => { setTab('desk'); setFocusCall(undefined); setView('phone') }} />
        </Suspense>
      </div>

      <button className={`mini ${tucked.on ? 'on' : ''}`} onClick={tucked.open} aria-label="show menu" tabIndex={tucked.on ? 0 : -1}>
        <MiniBot />
      </button>
      <header className={`bar ${tucked.on ? 'tuck' : ''}`}>
        <button className="brand" onClick={() => { setTab('desk'); setView('third') }}>
          <BotMark size={30} />
          <span>GrokGrid</span>
          <span className="crew" aria-hidden>
            {CREW.map(([color, shape, habit], i) => (
              <LiveBot key={color} color={color} shape={shape} habit={habit} size={24} delay={i * -0.53} />
            ))}
          </span>
        </button>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={`${t === tab ? 'on' : ''} ${t === 'stats' ? 'split' : ''}`} onClick={() => setTab(t)}>
              <Roll>{t}</Roll>
            </button>
          ))}
        </nav>
        <div className="bar-right">
          {feed.mode === 'live' && (
            <span className="status mono live">
              <i />
              live
            </span>
          )}
          {X_HANDLE && (
            <a className="chip mono" href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer">@{X_HANDLE}</a>
          )}
          <BuyButton />
        </div>
      </header>

      <section className="calls-dock" aria-label="latest calls">
        {feed.calls.slice(0, 2).map((c, i) => (
          <div key={c.id} className={`dock-card ${i ? 'older' : ''}`}>
            <CallCard
              call={c}
              compact
              onOpen={(card) =>
                morphOpen(card, c.id, () => {
                  setFocusCall(c.id)
                  setTab('calls')
                })
              }
            />
          </div>
        ))}
      </section>

      <div className="views" role="tablist" aria-label="camera">
        <button role="tab" aria-selected={view === 'third'} className={view === 'third' ? 'on' : ''} onClick={() => setView('third')}>
          <Roll>his room</Roll> <kbd>1</kbd>
        </button>
        <button role="tab" aria-selected={view === 'phone'} className={view === 'phone' ? 'on' : ''} onClick={() => { setTab('desk'); setFocusCall(undefined); setView('phone') }}>
          <Roll>his phone</Roll> <kbd>2</kbd>
        </button>
      </div>

      <dl className="strip mono">
        <div><dt>wallet</dt><dd>{s.solNow.toFixed(2)} SOL</dd></div>
        <div><dt>24h</dt><dd className={s.pnl24h >= 0 ? 'gain' : 'loss'}>{pct(s.pnl24h)}</dd></div>
        <div><dt>trades</dt><dd>{s.trades}</dd></div>
        <div><dt>win</dt><dd>{(s.winRate === null ? '–' : s.winRate.toFixed(0))}%</dd></div>
      </dl>

      <aside className="panel" aria-hidden={tab !== 'calls'}>
        <button className="panel-x" onClick={() => setTab('desk')} aria-label="close">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <div className="panel-body">
          <CallsPanel feed={feed} focus={tab === 'calls' ? focusCall : undefined} />
        </div>
      </aside>

      {tab === 'stats' && <StatsPage feed={feed} />}
      {tab === 'matrix' && <MatrixPage grid={grid} feed={feed} />}
      {tab === 'grid' && <GridPage grid={grid} />}
      {tab === 'docs' && <DocsPage onTour={() => setTouring(true)} />}

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

// Scrolling down anywhere folds the top bar into a single bot; one scroll up brings it back.
function useTuck() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const tops = new WeakMap<EventTarget, number>()
    let touchY = 0
    const go = (dy: number) => {
      if (dy > 2) setOn(true)
      else if (dy < -2) setOn(false)
    }
    const onWheel = (e: WheelEvent) => go(e.deltaY)
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.documentElement : (e.target as HTMLElement)
      if (!el || !('scrollTop' in el)) return
      const prev = tops.get(el) ?? 0
      tops.set(el, el.scrollTop)
      go(el.scrollTop - prev)
    }
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0].clientY)
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY
      if (Math.abs(y - touchY) < 12) return
      go(touchY - y)
      touchY = y
    }
    const opts = { passive: true, capture: true }
    addEventListener('wheel', onWheel, opts)
    document.addEventListener('scroll', onScroll, opts)
    addEventListener('touchstart', onTouchStart, opts)
    addEventListener('touchmove', onTouchMove, opts)
    return () => {
      removeEventListener('wheel', onWheel, opts)
      document.removeEventListener('scroll', onScroll, opts)
      removeEventListener('touchstart', onTouchStart, opts)
      removeEventListener('touchmove', onTouchMove, opts)
    }
  }, [])
  return { on, open: () => setOn(false) }
}

// The folded bar's bot: floats slowly in its box, blinks and glances now and then.
function MiniBot() {
  return (
    <span className="mb">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id="mb-g" cx="0.4" cy="0.34" r="0.72">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.7" stopColor="#e7e7e7" />
            <stop offset="1" stopColor="#bcbcbc" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="44" fill="url(#mb-g)" />
        <g className="mb-eyes" fill="#0a0a0a">
          {HOUSE_EYES.map(([cx, cy]) => (
            <rect key={cx} x={cx - 5.5} y={cy - 12.5} width="11" height="25" rx="5.5" transform={`rotate(-27 ${cx} ${cy})`} />
          ))}
        </g>
      </svg>
      <i className="mb-shadow" />
    </span>
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
      <a className="buy" href={buyUrl()} target="_blank" rel="noreferrer"><Roll>{`Buy $${MAIN_TICKER}`}</Roll></a>
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
