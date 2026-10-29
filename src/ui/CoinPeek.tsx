import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { mc, pct } from '../lib/format'
import { CoinChip } from './CoinChip'
import './coinpeek.css'

// One floating coin card for the whole page. Hover a coin anywhere on the matrix or a
// bot profile and the card glides to it instead of popping a new one per coin.
export interface PeekCoin {
  symbol: string
  name?: string
  image?: string
  hue: string
  mcUsd?: number
  vol24hUsd?: number
  change24h?: number
  tag?: string // a small label over the name: "his coin", "bought", "sold"
  rows?: [string, ReactNode, string?][] // extra lines under the market stats
}

type State = { coin: PeekCoin; rect: DOMRect } | null
let state: State = null
let hideTimer = 0
const subs = new Set<() => void>()
const emit = (s: State) => {
  state = s
  subs.forEach((f) => f())
}

export function peek(coin: PeekCoin) {
  const show = (el: Element) => {
    clearTimeout(hideTimer)
    emit({ coin, rect: el.getBoundingClientRect() })
  }
  // a short grace period lets the pointer slide from one coin to the next without a flicker
  const hide = () => {
    clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => emit(null), 140)
  }
  return {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType !== 'touch' && show(e.currentTarget),
    onPointerLeave: hide,
    onFocus: (e: React.FocusEvent) => show(e.currentTarget),
    onBlur: hide,
  }
}

export function PeekLayer() {
  const s = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  )
  const card = useRef<HTMLDivElement>(null)
  const last = useRef<PeekCoin | null>(null)
  if (s) last.current = s.coin
  const [pos, setPos] = useState({ x: 0, y: 0, below: false, snap: true })
  const shown = useRef(false)

  useLayoutEffect(() => {
    if (!s || !card.current) {
      shown.current = false
      return
    }
    const w = card.current.offsetWidth, h = card.current.offsetHeight
    const below = s.rect.top < h + 16
    const x = Math.min(Math.max(10, s.rect.left + s.rect.width / 2 - w / 2), innerWidth - w - 10)
    const y = below ? s.rect.bottom + 10 : s.rect.top - h - 10
    // appearing: jump straight to the coin; already open: glide to the next one
    setPos({ x, y, below, snap: !shown.current })
    shown.current = true
  }, [s])

  // scrolling moves the coin away from its card: let it go
  useEffect(() => {
    const off = () => state && emit(null)
    addEventListener('scroll', off, { passive: true, capture: true })
    return () => removeEventListener('scroll', off, { capture: true })
  }, [])

  const c = last.current
  return createPortal(
    <div
      ref={card}
      className={`peek ${s ? 'on' : ''} ${pos.below ? 'below' : ''} ${pos.snap ? 'snap' : ''}`}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      aria-hidden
    >
      {c && (
        <>
          <div className="peek-top">
            <CoinChip call={{ symbol: c.symbol, image: c.image, hue: c.hue }} size={38} />
            <div>
              {c.tag && <em className="mono">{c.tag}</em>}
              <b>${c.symbol}</b>
              {c.name && <span>{c.name}</span>}
            </div>
          </div>
          {c.mcUsd !== undefined && (
            <dl className="peek-stats mono">
              <div><dt>mc</dt><dd>{c.mcUsd ? mc(c.mcUsd) : '–'}</dd></div>
              <div><dt>24h vol</dt><dd>{c.vol24hUsd ? mc(c.vol24hUsd) : '–'}</dd></div>
              <div><dt>24h</dt><dd className={c.mcUsd ? (c.change24h ?? 0) >= 0 ? 'gain' : 'loss' : ''}>{c.mcUsd ? pct(c.change24h ?? 0) : '–'}</dd></div>
            </dl>
          )}
          {!!c.rows?.length && (
            <dl className="peek-rows mono">
              {c.rows.map(([k, v, cls]) => (
                <div key={k}><dt>{k}</dt><dd className={cls}>{v}</dd></div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>,
    document.body,
  )
}
