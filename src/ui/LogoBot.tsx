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
  [-0.35, -0.2, 900], // a glance away
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
      lx += (tx + drift - lx) * 0.07
      ly += (ty + Math.cos(now / 1300) * 0.03 - ly) * 0.07
      open += ((now < blinkEnd ? 0.08 : 1) - open) * (now < blinkEnd ? 0.45 : 0.25)
      const [a, b] = eyePaths('sphere', lx, ly, 1, open)
      e1.current!.setAttribute('d', a)
      e2.current!.setAttribute('d', b)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate])

  return (
    <svg className={`logo-bot ${animate ? 'alive' : ''}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
      <defs>
        {/* cool on the left, warm on the right, as in the artwork */}
        <linearGradient id={`${id}-rim`} x1="0" y1="0.2" x2="1" y2="0.8">
          <stop offset="0" stopColor="#3d6bff" />
          <stop offset="0.45" stopColor="#a04dff" />
          <stop offset="1" stopColor="#ff8a2e" />
        </linearGradient>
        <radialGradient id={`${id}-fade`} gradientUnits="userSpaceOnUse" cx={BX + 5} cy={BY - 9} r={BR + 8}>
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </radialGradient>
        <mask id={`${id}-edge`}>
          <rect width="100" height="100" fill={`url(#${id}-fade)`} />
        </mask>
        <radialGradient id={`${id}-hand`} gradientUnits="userSpaceOnUse" cx="-1" cy="-4" r="15">
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </radialGradient>
        <mask id={`${id}-hedge`}>
          <rect x="-50" y="-50" width="100" height="100" fill={`url(#${id}-hand)`} />
        </mask>
      </defs>
      <g className="lg-float">
        <g className="lg-body">
          <circle cx={BX} cy={BY} r={BR} fill="#fbfbfd" />
          <circle cx={BX} cy={BY} r={BR} fill={`url(#${id}-rim)`} mask={`url(#${id}-edge)`} opacity="0.85" />
          {/* his eyes lean the way his head turns toward the phone, as in the artwork */}
          <g transform={`rotate(-22 ${BX + 9} ${BY + 2}) ${EYE}`}>
            <path ref={e1} d={d1} fill="#111" />
            <path ref={e2} d={d2} fill="#111" />
          </g>
        </g>
        <g className="lg-hands">
          {/* the phone, tucked between his hands */}
          <g className="lg-phone">
            <g transform="rotate(30 68 66)">
              <rect x="60" y="50" width="16" height="31" rx="3.6" fill="#16181d" />
              <rect x="60.7" y="50.7" width="14.6" height="29.6" rx="3" fill="none" stroke="#3b4256" strokeWidth="0.9" />
              <rect x="63" y="53" width="7.4" height="7.4" rx="2" fill="#0b0c10" />
              <circle cx="65" cy="55" r="1.3" fill="#05060a" stroke="#2f3546" strokeWidth="0.45" />
              <circle cx="65" cy="58.4" r="1.3" fill="#05060a" stroke="#2f3546" strokeWidth="0.45" />
              <circle cx="68.3" cy="56.7" r="1.3" fill="#05060a" stroke="#2f3546" strokeWidth="0.45" />
            </g>
          </g>
          <g className="lg-hand lg-hand-l" transform="translate(52 79) rotate(-18)">
            <ellipse rx="13" ry="10.5" fill="#fbfbfd" />
            <ellipse rx="13" ry="10.5" fill={`url(#${id}-rim)`} mask={`url(#${id}-hedge)`} opacity="0.9" />
          </g>
          <g className="lg-hand lg-hand-r" transform="translate(73 76) rotate(-24)">
            <ellipse rx="11.5" ry="10" fill="#fbfbfd" />
            <ellipse rx="11.5" ry="10" fill={`url(#${id}-rim)`} mask={`url(#${id}-hedge)`} opacity="0.9" />
          </g>
        </g>
      </g>
    </svg>
  )
}
