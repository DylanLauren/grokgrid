import { useEffect, useRef, useState } from 'react'
import { MAIN_TICKER } from '../config'
import './moneyflow.css'

// Where the money goes, as two split bars in the site's card style: one for $GRID fees,
// one for every bot coin's fees. The first time the card scrolls into view the bars fill to
// their split and the shares count up; after that a soft light keeps moving along each bar.
// Still with reduced motion.
const ROWS = [
  {
    from: `$${MAIN_TICKER} creator fees`,
    split: [
      { pct: 80, to: 'treasury', note: 'Grok Bot’s own trading wallet' },
      { pct: 20, to: 'buy and burn', note: `buys $${MAIN_TICKER} and burns it` },
    ],
  },
  {
    from: 'bot coin creator fees',
    split: [
      { pct: 80, to: 'that bot’s wallet', note: 'the bot trades with it' },
      { pct: 20, to: 'buy and burn', note: `buys $${MAIN_TICKER} and burns it` },
    ],
  },
]

export function MoneyFlow() {
  const ref = useRef<HTMLDivElement>(null)
  const [still] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [k, setK] = useState(still ? 1 : 0) // 0..1, how far the bars have filled

  useEffect(() => {
    const el = ref.current
    if (!el || still) return
    let raf = 0
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 1100)
        setK(1 - Math.pow(1 - t, 4))
        if (t < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, { threshold: 0.35 })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [still])

  return (
    <div ref={ref} className={`mf ${k === 1 ? 'done' : ''}`} role="table" aria-label="where creator fees go">
      {ROWS.map((r) => (
        <div key={r.from} className="mf-row" role="row">
          <div className="mf-from mono">{r.from}</div>
          <div className="mf-bar" aria-hidden="true">
            {r.split.map((s, i) => (
              <span key={i} className={`mf-seg ${i ? 'burn' : ''}`} style={{ width: `${s.pct * k}%` }} />
            ))}
          </div>
          <div className="mf-to">
            {r.split.map((s, i) => (
              <div key={i} className={i ? 'burn' : ''} role="cell" style={{ flexBasis: `${s.pct}%` }}>
                <b>{Math.round(s.pct * k)}%</b>
                <span>{s.to}</span>
                <small>{s.note}</small>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
