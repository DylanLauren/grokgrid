import { forwardRef, useEffect, useRef, type CSSProperties } from 'react'
import { BODY, type Shape } from './BotMark'
import { eyeInk, eyePaths, watch, type Face } from './eyes'
import './livebot.css'

// One of the bot family, alive, the way the official Grok Bots are: a flat matte body,
// pill eyes painted on a ball that glance around on their own, watch the pointer, and
// turn to face you when you hover. Each keeps a gentle idle habit of its own.
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
  hoverFace?: Face // the face it pulls while you hover it
}

export const LiveBot = forwardRef<HTMLDivElement, Props>(function LiveBot({ color, shape, habit, size, say, delay = 0, selected, eye, shout, hoverFace }, ref) {
  const root = useRef<HTMLDivElement | null>(null)
  const e1 = useRef<SVGPathElement>(null)
  const e2 = useRef<SVGPathElement>(null)
  useEffect(() => {
    if (!root.current || !e1.current || !e2.current) return
    return watch(root.current, [e1.current, e2.current], shape, habit === 'doze')
  }, [shape, habit])
  const house = color === 'house'
  const [d1, d2] = eyePaths(shape, 0, 0, 1, habit === 'doze' ? 0.22 : 1)
  const ink = eye ?? (house ? '#1a1a1a' : eyeInk(color))
  return (
    <div
      ref={(el) => {
        root.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      className={`lb lb-${habit} ${selected ? 'sel' : ''} ${shout ? 'shout' : ''}`}
      style={{ width: size, height: size, '--d': `${delay}s` } as CSSProperties}
      data-hover-face={hoverFace}
    >
      <span className="lb-shadow" />
      <div className="lb-body">
        <div className="lb-habit">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <path d={BODY[shape]} fill={house ? '#ffffff' : color} />
            <path ref={e1} d={d1} fill={ink === '#0a0a0a' ? '#1a1a1a' : ink} />
            <path ref={e2} d={d2} fill={ink === '#0a0a0a' ? '#1a1a1a' : ink} />
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

// Kept for callers: every LiveBot now watches the pointer on its own.
export function useEyesFollow(_root: React.RefObject<HTMLElement | null>) {}
