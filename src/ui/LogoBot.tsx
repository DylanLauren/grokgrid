import { useEffect, useId, useRef } from 'react'
import { eyePaths } from './eyes'
import './logobot.css'

// The GrokGrid mark: Grok Bot with his phone in both hands, a cool blue edge on one side and a
// warm one on the other. Alive like the bot in the room: his eyes stay on the phone, glance up
// at you now and then, blink, and everything eases in and out so nothing ever snaps.

// body circle in the 0..100 viewBox, and how the shared eye drawing (centred 50,50 r44) maps onto it
const BX = 45, BY = 44, BR = 33
const EYE = `translate(${BX - 50 * (BR / 44)} ${BY - 50 * (BR / 44)}) scale(${BR / 44})`

// where he looks: mostly down at the phone, sometimes up at you, sometimes off to the side
const LOOKS: [number, number, number][] = [
  [0.62, 0.28, 2600], // phone
  [0.7, 0.36, 1800], // phone, reading further down
  [0.15, -0.05, 1100], // up at you
  [0.58, 0.24, 2400],
]

const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function LogoBot({ size = 30, animate = true }: { size?: number; animate?: boolean }) {
  const id = 'lg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const e1 = useRef<SVGPathElement>(null)
  const e2 = useRef<SVGPathElement>(null)
  const [d1, d2] = eyePaths('sphere', LOOKS[0][0], LOOKS[0][1])

  useEffect(() => {
    if (!animate || still || !e1.current || !e2.current) return
    let raf = 0, step = 0, nextLook = performance.now() + LOOKS[0][2]
    let lx = LOOKS[0][0], ly = LOOKS[0][1], tx = lx, ty = ly
    let open = 1, blinkAt = performance.now() + 2000 + Math.random() * 2000, blinkEnd = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (document.hidden) return
      if (now > nextLook) {
        step = (step + 1) % LOOKS.length
        ;[tx, ty] = LOOKS[step]
        nextLook = now + LOOKS[step][2] + Math.random() * 600
      }
      if (now > blinkAt) {
        blinkEnd = now + 170
        blinkAt = now + 2600 + Math.random() * 3200
      }
      // a slow drift on top of the target keeps the eyes moving like they're reading
      const drift = Math.sin(now / 900) * 0.04
      lx += (tx + drift - lx) * 0.05
      ly += (ty + Math.cos(now / 1300) * 0.03 - ly) * 0.05
      open += ((now < blinkEnd ? 0.08 : 1) - open) * (now < blinkEnd ? 0.45 : 0.25)
      const [a, b] = eyePaths('sphere', lx, ly, 1, open)
      e1.current!.setAttribute('d', a)
      e2.current!.setAttribute('d', b)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate])

  return (
    <svg className={`logo-bot ${animate ? 'alive' : ''}`} width={size} height={size} viewBox="9 9 82 82" aria-hidden="true" style={{ flex: 'none' }}>
      <defs>
        {/* cool on the left, warm on the right, as in the artwork; a soft white core sits on top */}
        <linearGradient id={`${id}-rim`} x1="0.05" y1="0.35" x2="0.95" y2="0.75">
          <stop offset="0" stopColor="#4a6dff" />
          <stop offset="0.5" stopColor="#b25cff" />
          <stop offset="1" stopColor="#ff9142" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.56" cy="0.4" r="0.62">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.62" stopColor="#fbfbff" />
          <stop offset="0.86" stopColor="#fbfbff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fbfbff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-hcore`} cx="0.5" cy="0.32" r="0.68">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.55" stopColor="#fbfbff" />
          <stop offset="0.9" stopColor="#fbfbff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fbfbff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2f3b" />
          <stop offset="1" stopColor="#0d0f14" />
        </linearGradient>
      </defs>
      <g className="lg-float">
        <g className="lg-body">
          <circle cx={BX} cy={BY} r={BR} fill={`url(#${id}-rim)`} />
          <circle cx={BX} cy={BY} r={BR + 0.2} fill={`url(#${id}-core)`} />
          {/* his eyes lean the way his head turns toward the phone, as in the artwork */}
          <g transform={`rotate(-20 ${BX + 9} ${BY + 2}) ${EYE}`}>
            <path ref={e1} d={d1} fill="#0e0e12" />
            <path ref={e2} d={d2} fill="#0e0e12" />
          </g>
        </g>
        <g className="lg-hands">
          {/* the phone, tucked between his hands */}
          <g transform="rotate(30 68 66)">
            <rect x="60.5" y="50" width="15" height="30" rx="4" fill={`url(#${id}-glass)`} />
            <rect x="63" y="52.8" width="6.4" height="6.4" rx="2" fill="#07080b" />
          </g>
          <g className="lg-hand lg-hand-l" transform="translate(52.5 79.5) rotate(-16)">
            <ellipse rx="12.5" ry="10.2" fill={`url(#${id}-rim)`} />
            <ellipse rx="12.7" ry="10.4" fill={`url(#${id}-hcore)`} />
          </g>
          <g className="lg-hand lg-hand-r" transform="translate(72.5 76.5) rotate(-22)">
            <ellipse rx="11" ry="9.6" fill={`url(#${id}-rim)`} />
            <ellipse rx="11.2" ry="9.8" fill={`url(#${id}-hcore)`} />
          </g>
        </g>
      </g>
    </svg>
  )
}
