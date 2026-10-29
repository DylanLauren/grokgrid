import { useEffect, useRef, useState } from 'react'
import { MAIN_TICKER } from '../config'
import './moneyflow.css'

// Where the money goes, moving: SOL drops travel each route, four drops down an 80% route for
// every one down a 20% route, so the split reads at a glance. Lines flow, each stop lights as
// drops land, and the burn gives off embers. Paused off screen; a still diagram with reduced motion.
const W = 560, H = 316
const CYCLE = 4 // seconds for one round of drops

type Node = { id: string; x: number; y: number; w: number; label: string; sub: string; main?: boolean }
const NODES: Node[] = [
  { id: 'fees', x: 16, y: 20, w: 178, label: `$${MAIN_TICKER} fees`, sub: 'creator fees', main: true },
  { id: 'treasury', x: 366, y: 20, w: 178, label: 'treasury', sub: 'funds Grok Bot' },
  { id: 'wallets', x: 366, y: 128, w: 178, label: 'grid bot wallets', sub: 'each bot trades' },
  { id: 'coins', x: 366, y: 236, w: 178, label: 'grid bot coin fees', sub: 'from every bot coin' },
  { id: 'burn', x: 16, y: 236, w: 178, label: 'buy and burn', sub: `burns $${MAIN_TICKER}` },
]
const NH = 46
const at = (id: string) => NODES.find((n) => n.id === id)!

// each route: path, its share label, where the label sits, and how many drops per round
const ROUTES = [
  { id: 'r1', d: `M194 ${20 + NH / 2}H366`, label: '80%', lx: 280, ly: 34, drops: 4, to: 'treasury' },
  { id: 'r2', d: `M455 ${20 + NH}V128`, label: 'creates bots', lx: 463, ly: 100, drops: 4, to: 'wallets' },
  { id: 'r3', d: `M455 236V${128 + NH}`, label: '80% trades', lx: 463, ly: 210, drops: 4, to: 'wallets' },
  { id: 'r4', d: `M366 ${236 + NH / 2}H194`, label: '20%', lx: 280, ly: 250, drops: 1, to: 'burn' },
  { id: 'r5', d: `M105 ${20 + NH}V236`, label: '20%', lx: 113, ly: 154, drops: 1, to: 'burn' },
]

export function MoneyFlow() {
  const ref = useRef<SVGSVGElement>(null)
  const [still] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [seen, setSeen] = useState(false)

  // run only while it's on screen; the first time it shows, the split counts in
  useEffect(() => {
    const svg = ref.current
    if (!svg || still) return
    svg.pauseAnimations?.()
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setSeen(true)
        svg.unpauseAnimations?.()
      } else svg.pauseAnimations?.()
    }, { threshold: 0.2 })
    io.observe(svg)
    return () => io.disconnect()
  }, [still])

  return (
    <svg
      ref={ref}
      className={`mf ${seen || still ? 'in' : ''} ${still ? 'still' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`$${MAIN_TICKER} fees: 80% to the treasury, which creates grid bots, 20% to buy and burn. Grid bot coin fees: 80% to that bot's trading wallet, 20% to buy and burn.`}
    >
      <defs>
        <radialGradient id="mf-drop">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mf-ember">
          <stop offset="0" stopColor="#ffb36b" />
          <stop offset="1" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the routes: a faint track with a flowing dash on top */}
      {ROUTES.map((r, i) => (
        <g key={r.id} className="mf-route" style={{ '--i': i } as React.CSSProperties}>
          <path id={`mf-${r.id}`} d={r.d} className="mf-track" />
          <path d={r.d} className={`mf-dash ${r.drops > 1 ? 'big' : ''}`} />
          <text x={r.lx} y={r.ly} className="mf-label" textAnchor={r.id === 'r2' || r.id === 'r3' || r.id === 'r5' ? 'start' : 'middle'}>
            {r.label}
          </text>
        </g>
      ))}

      {/* drops: four down each 80% route for every one down a 20% route */}
      {!still &&
        ROUTES.flatMap((r) =>
          Array.from({ length: r.drops }, (_, k) => {
            const begin = `${((k / r.drops) * CYCLE + (r.id === 'r2' ? 0.9 : 0)).toFixed(2)}s`
            return (
              <circle key={`${r.id}-${k}`} r={r.drops > 1 ? 5 : 6} fill="url(#mf-drop)" opacity="0">
                <animateMotion dur={`${CYCLE / 2}s`} begin={begin} repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1">
                  <mpath href={`#mf-${r.id}`} />
                </animateMotion>
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur={`${CYCLE / 2}s`} begin={begin} repeatCount="indefinite" />
              </circle>
            )
          }),
        )}

      {/* the stops */}
      {NODES.map((n) => (
        <g key={n.id} className={`mf-node mf-${n.id} ${n.main ? 'main' : ''}`}>
          <rect x={n.x} y={n.y} width={n.w} height={NH} rx={NH / 2} />
          {!still && !n.main && (
            <rect x={n.x} y={n.y} width={n.w} height={NH} rx={NH / 2} className="mf-hit">
              <animate attributeName="opacity" values="0;0.9;0" keyTimes="0;0.08;1" dur={`${CYCLE / 4}s`} begin={n.id === 'burn' ? '2s' : n.id === 'wallets' ? '1.9s' : '1.8s'} repeatCount="indefinite" />
            </rect>
          )}
          <text x={n.x + n.w / 2} y={n.y + 20} textAnchor="middle" className="mf-name">{n.label}</text>
          <text x={n.x + n.w / 2} y={n.y + 35} textAnchor="middle" className="mf-sub">{n.sub}</text>
        </g>
      ))}

      {/* embers drift off the burn and fade */}
      {!still &&
        [0, 1, 2, 3, 4].map((k) => {
          const b = at('burn')
          const x = b.x + 40 + k * 24
          const begin = `${(k * 0.55).toFixed(2)}s`
          return (
            <circle key={k} cx={x} cy={b.y + NH + 4} r="3.2" fill="url(#mf-ember)" opacity="0">
              <animate attributeName="cy" values={`${b.y + NH + 6};${b.y + NH + 24}`} dur="2.6s" begin={begin} repeatCount="indefinite" />
              <animate attributeName="cx" values={`${x};${x + (k % 2 ? 6 : -6)};${x}`} dur="2.6s" begin={begin} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.9;0" dur="2.6s" begin={begin} repeatCount="indefinite" />
            </circle>
          )
        })}
    </svg>
  )
}
