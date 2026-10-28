import { forwardRef, useEffect, type CSSProperties } from 'react'
import { BODY, EYES, HOUSE_EYES, type Shape } from './BotMark'
import './livebot.css'

// One of the bot family, alive: an idle habit of its own, a blink, eyes that follow
// the pointer (set from outside through --ex/--ey), and a jump when you hover it.
export type Habit = 'look' | 'bounce' | 'float' | 'sway' | 'tilt' | 'flip' | 'hop' | 'squish' | 'doze'

interface Props {
  color: string
  shape: Shape
  habit: Habit
  size: number
  say?: string
  delay?: number
  selected?: boolean
  eye?: string
  shout?: boolean // keep the speech bubble out without a hover
}

export const LiveBot = forwardRef<HTMLDivElement, Props>(function LiveBot({ color, shape, habit, size, say, delay = 0, selected, eye = '#fff', shout }, ref) {
  return (
    <div ref={ref} className={`lb lb-${habit} ${selected ? 'sel' : ''} ${shout ? 'shout' : ''}`} style={{ width: size, height: size, '--d': `${delay}s` } as CSSProperties}>
      <span className="lb-shadow" />
      <div className="lb-body">
        <div className="lb-habit">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            {color === 'house' && (
              <defs>
                <radialGradient id="lb-house" cx="0.4" cy="0.34" r="0.72">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.7" stopColor="#e7e7e7" />
                  <stop offset="1" stopColor="#bcbcbc" />
                </radialGradient>
              </defs>
            )}
            <path d={BODY[shape]} fill={color === 'house' ? 'url(#lb-house)' : color} />
            <g className="lb-eyes">
              <g className="lb-blink">
                {(color === 'house' ? HOUSE_EYES : EYES).map(([cx, cy], i) => (
                  <rect key={i} x={cx - 5.5} y={cy - 12.5} width="11" height="25" rx="5.5" fill={eye} transform={`rotate(-27 ${cx} ${cy})`} />
                ))}
              </g>
            </g>
          </svg>
        </div>
      </div>
      {habit === 'doze' && <span className="lb-z mono">z</span>}
      {say && (
        <span className="lb-say" aria-label={say}>
          {shout
            ? [...say].map((c, i) => (
                <span key={i} aria-hidden className="lb-wave" style={{ '--i': i } as CSSProperties}>
                  {c === ' ' ? '\u00a0' : c}
                </span>
              ))
            : say}
        </span>
      )}
    </div>
  )
})

// Every bot inside root turns its eyes toward the pointer.
export function useEyesFollow(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    let raf = 0
    let px = 0
    let py = 0
    const apply = () => {
      raf = 0
      root.current?.querySelectorAll<HTMLElement>('.lb').forEach((el) => {
        const r = el.getBoundingClientRect()
        const dx = px - (r.left + r.width / 2)
        const dy = py - (r.top + r.height / 2)
        const d = Math.hypot(dx, dy) || 1
        const k = Math.min(1, d / 300) * 6
        el.style.setProperty('--ex', `${(dx / d) * k}px`)
        el.style.setProperty('--ey', `${(dy / d) * k}px`)
      })
    }
    const move = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    addEventListener('pointermove', move)
    return () => {
      removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [root])
}
