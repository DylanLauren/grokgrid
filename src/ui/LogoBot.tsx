import { useEffect, useId, useRef } from 'react'
import { eyePaths, watchWith } from './eyes'
import './logobot.css'

// The GrokGrid mark: Grok Bot with his phone in both hands, a cool blue edge on one side and a
// warm one on the other. Alive like the bot in the room: his eyes stay on the phone, glance up
// at you now and then, blink, watch your pointer when it comes near, and nothing ever snaps.

// body circle in the 0..100 viewBox, and how the shared eye drawing (centred 50,50 r44) maps onto it
const BX = 45, BY = 44, BR = 33
const EYE = `translate(${BX - 50 * (BR / 44)} ${BY - 50 * (BR / 44)}) scale(${BR / 44})`

// where he looks: home is down at the phone; now and then further down, off to the side, or up at you
const LOOKS: [number, number][] = [
  [0.62, 0.28], // phone
  [0.7, 0.38], // reading further down
  [0.5, 0.22],
  [0.15, -0.05], // up at you
  [0.78, 0.12],
]

export function LogoBot({ size = 30, animate = true }: { size?: number; animate?: boolean }) {
  const id = 'lg' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const svg = useRef<SVGSVGElement>(null)
  const e1 = useRef<SVGPathElement>(null)
  const e2 = useRef<SVGPathElement>(null)
  const [d1, d2] = eyePaths('sphere', LOOKS[0][0], LOOKS[0][1])

  // the same clock as the rest of the family: glances, blinks, and the pointer when it comes close
  useEffect(() => {
    if (!animate || !svg.current || !e1.current || !e2.current) return
    const [p1, p2] = [e1.current, e2.current]
    return watchWith(svg.current, (lx, ly, sc, o1, o2) => {
      const [a, b] = eyePaths('sphere', lx, ly, sc, o1, o2)
      p1.setAttribute('d', a)
      p2.setAttribute('d', b)
    }, { glances: LOOKS, reach: 4 })
  }, [animate])

  return (
    <svg ref={svg} className={`logo-bot ${animate ? 'alive' : ''}`} width={size} height={size} viewBox="9 9 82 82" aria-hidden="true" style={{ flex: 'none' }}>
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
