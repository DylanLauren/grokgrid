import { lazy, Suspense, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { GITHUB_URL, MAIN_MINT, MAIN_NAME, MAIN_TICKER, X_HANDLE, buyUrl } from './config'
import { XMark } from './ui/XMark'
import { GitHubMark } from './ui/GitHubMark'
import { LogoBot } from './ui/LogoBot'
import { stats, useFeed } from './data/useFeed'
import type { View } from './scene/Scene'
import { pct } from './lib/format'
import type { Shape } from './ui/BotMark'
import { LiveBot, type Habit } from './ui/LiveBot'
import { CallCard } from './ui/CallCard'
import { CallsPanel } from './ui/Panels'
import { useAgents } from './data/useAgents'
import { useLive } from './data/useLive'
import { seenTour, Tour } from './ui/Tour'
import { Roll } from './ui/Roll'
import { Intro, introDue } from './ui/Intro'
import { StatsPage } from './pages/StatsPage'
import { MatrixPage } from './pages/MatrixPage'
import { GridPage } from './pages/GridPage'
import { DocsPage } from './pages/DocsPage'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './app.css'

// his family, hanging around next to the logo
const CREW: [string, Shape, Habit][] = [
  ['#ff6a00', 'sphere', 'bounce'],
  ['#13b8a6', 'squircle', 'sway'],
  ['#9b5cff', 'tile', 'tilt'],
  ['#ff2e9a', 'drop', 'hop'],
  ['#1683ff', 'sphere', 'flip'],
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
// #docs/how opens the docs at a section; anything unknown is his desk
const hashTab = (): Tab => {
  const h = location.hash.slice(1).split('/')[0] as Tab
  return TABS.includes(h) ? h : 'desk'
}

export default function App() {
  const feed = useFeed()
  const [view, setView] = useState<View>('third')
  const [tab, setTab] = useState<Tab>(hashTab)
  const s = stats(feed)
  const onPage = !ROOM.includes(tab)
  const grid = useAgents(tab === 'matrix' || tab === 'grid')
  const live = useLive(!onPage, view === 'phone', feed)
  // the first-visit tour only starts on his desk, never over a page someone linked to
  const [touring, setTouring] = useState(() => !seenTour() && !location.hash.slice(1))
  const [intro, setIntro] = useState(introDue)
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

  // the tab lives in the hash, so back, forward and edited links all land on the right page
  useEffect(() => {
    if (hashTab() === tab) return
    // the tour flips through tabs; it shouldn't fill the back button
    history[touring ? 'replaceState' : 'pushState'](null, '', tab === 'desk' ? location.pathname + location.search : `#${tab}`)
  }, [tab, touring])

  useEffect(() => {
    const onHash = () => setTab(hashTab())
    addEventListener('hashchange', onHash)
    addEventListener('popstate', onHash)
    return () => {
      removeEventListener('hashchange', onHash)
      removeEventListener('popstate', onHash)
    }
  }, [])

  // #docs/<id> scrolls to that section once the docs are up
  useEffect(() => {
    if (tab !== 'docs') return
    const go = () => {
      const id = location.hash.slice(1).split('/')[1]
      if (id) requestAnimationFrame(() => document.getElementById(`dc-${id}`)?.scrollIntoView())
    }
    go()
    addEventListener('hashchange', go)
    return () => removeEventListener('hashchange', go)
  }, [tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') {
        setTab('desk')
        setView('third')
      }
      if (!ROOM.includes(tab)) return
      if (e.key === '1') setView('third')
      if (e.key === '2') { setTab('desk'); setFocusCall(undefined); setView('phone') }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [tab])

  return (
    <div className={`app ${tab === 'calls' ? 'has-panel' : ''} ${onPage ? 'on-page' : ''} view-${view}`}>
      <div className="stage" aria-hidden={onPage}>
        <ErrorBoundary fallback={<NoRoom />}>
          <Suspense fallback={<Boot />}>
            <Scene feed={feed} live={live} view={view} paused={onPage} onPhone={() => { setTab('desk'); setFocusCall(undefined); setView('phone') }} />
          </Suspense>
        </ErrorBoundary>
      </div>

      {/* the folded bar: the bot in its box; hover it and the links drop out underneath */}
      <div className={`mini-wrap ${tucked.on ? 'on' : ''}`}>
        <button className="mini" onClick={tucked.open} aria-label="show menu" tabIndex={tucked.on ? 0 : -1}>
          <MiniBot />
        </button>
        <nav className="mini-menu" aria-label="links">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" tabIndex={tucked.on ? 0 : -1}>
              <span className="mini-ico">{l.icon}</span>
              <span>{l.label}</span>
              <span className="mini-go" aria-hidden>↗</span>
            </a>
          ))}
        </nav>
      </div>
      <header className={`bar ${tucked.on ? 'tuck' : ''}`}>
        <button className="brand" onClick={() => { setTab('desk'); setView('third') }}>
          <LogoBot size={34} />
          <span>GrokGrid</span>
          <span className="crew" aria-hidden>
            {CREW.map(([color, shape, habit], i) => (
              <LiveBot key={color} color={color} shape={shape} habit={habit} size={26} delay={i * -0.53} />
            ))}
          </span>
        </button>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={`${t === tab ? 'on' : ''} ${t === 'stats' ? 'split' : ''}`} aria-current={t === tab ? 'page' : undefined} onClick={() => setTab(t)}>
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
          {LINKS.map((l) => (
            <a key={l.href} className="soc" href={l.href} target="_blank" rel="noreferrer" aria-label={l.label} title={l.label}>{l.icon}</a>
          ))}
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

      <div className="views" role="group" aria-label="camera">
        <button aria-pressed={view === 'third'} className={view === 'third' ? 'on' : ''} onClick={() => setView('third')}>
          <Roll>his room</Roll> <kbd>1</kbd>
        </button>
        <button aria-pressed={view === 'phone'} className={view === 'phone' ? 'on' : ''} onClick={() => { setTab('desk'); setFocusCall(undefined); setView('phone') }}>
          <Roll>his phone</Roll> <kbd>2</kbd>
        </button>
      </div>

      <dl className="strip mono">
        <div><dt>wallet</dt><dd>{s.solNow.toFixed(2)} SOL</dd></div>
        <div><dt>24h</dt><dd className={s.pnl24h >= 0 ? 'gain' : 'loss'}>{pct(s.pnl24h)}</dd></div>
        <div><dt>trades</dt><dd>{s.trades}</dd></div>
        <div><dt>win</dt><dd>{s.winRate === null ? '–' : `${s.winRate.toFixed(0)}%`}</dd></div>
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

      {intro && <Intro onDone={() => setIntro(false)} />}

      {touring && !intro && (
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

// where GrokGrid lives off the site: the bar shows them as icons, the folded bar as a list
const LINKS = [
  ...(X_HANDLE ? [{ href: `https://x.com/${X_HANDLE}`, label: `@${X_HANDLE} on X`, icon: <XMark size={14} /> }] : []),
  ...(GITHUB_URL ? [{ href: GITHUB_URL, label: 'source on GitHub', icon: <GitHubMark size={16} /> }] : []),
]

// The folded bar's bot: floats slowly in its box and looks around like the others.
function MiniBot() {
  return (
    <span className="mb">
      <LogoBot size={34} />
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

// no WebGL (or the room crashed): a still placeholder, the pages and calls carry on
function NoRoom() {
  return (
    <div className="boot still">
      <LogoBot size={72} />
      <span className="mono">3D room unavailable on this device. The pages still work.</span>
    </div>
  )
}

function Boot() {
  return (
    <div className="boot">
      <LogoBot size={72} />
      <span className="mono">waking him up</span>
    </div>
  )
}
