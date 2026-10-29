import { useEffect, useRef, useState } from 'react'
import { BODY, FAMILY, type Shape } from './BotMark'
import { eyeInk, eyePaths } from './eyes'
import './intro.css'

// The opening: the whole bot family flies across the screen like Superman, leaning in,
// swoops back and circles up around Grok Bot, then the ring bursts and the room shows.
// About 2.4 seconds, once per browser session. A click or any key skips it.
const KEY = 'gg-intro'
const FLY = 1050 // ms each bot spends crossing and swooping into the ring
const STAGGER = 42
const RING = 1950 // the ring starts to burst
const END = 2450

const BOTS: { color: string; shape: Shape }[] = [
  ...FAMILY.filter((f) => f.name !== 'black'),
  { color: '#ff6a00', shape: 'squircle' },
  { color: '#13b8a6', shape: 'cone' },
  { color: '#9b5cff', shape: 'sphere' },
  { color: '#1683ff', shape: 'drop' },
]

export function introDue() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  try {
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return true
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
type P = [number, number]
const bez = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ]
}

export function Intro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    try { sessionStorage.setItem(KEY, '1') } catch { /* private window */ }
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return done.current()
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const w = innerWidth, h = innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const cx = w / 2, cy = h / 2
    const unit = Math.min(w, h)
    const ringR = unit * 0.28
    const n = BOTS.length
    const paths = Object.fromEntries(Object.entries(BODY).map(([k, d]) => [k, new Path2D(d)])) as Record<Shape, Path2D>

    // each bot's flight: in from one edge, across past the middle, back round into its slot
    const bots = BOTS.map((b, i) => {
      const fromLeft = i % 2 === 0
      const y0 = h * (0.12 + ((i * 0.37) % 0.76))
      const size = unit * (0.088 + ((i * 0.13) % 0.03))
      return {
        ...b,
        size,
        start: i * STAGGER,
        p0: [fromLeft ? -size * 2 : w + size * 2, y0] as P,
        c1: [fromLeft ? w * 1.05 : -w * 0.05, y0 + (i % 3 - 1) * h * 0.12] as P,
        c2: [fromLeft ? cx + w * 0.35 : cx - w * 0.35, cy + (i % 2 ? -1 : 1) * h * 0.35] as P,
        trail: [] as P[],
        face: fromLeft ? 1 : -1,
      }
    })

    const slot = (i: number, now: number, r: number): P => {
      const a = (i / n) * Math.PI * 2 + now * 0.0024
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92]
    }

    // flat matte bodies with the same ball-painted eyes as the rest of the site
    const drawBot = (shape: Shape, color: string, size: number, house: boolean, lx = 0, ly = 0) => {
      ctx.save()
      ctx.scale(size / 100, size / 100)
      ctx.translate(-50, -50)
      ctx.fillStyle = house ? '#ffffff' : color
      ctx.fill(paths[shape])
      ctx.fillStyle = house ? '#1a1a1a' : eyeInk(color)
      for (const d of eyePaths(shape, lx, ly)) ctx.fill(new Path2D(d))
      ctx.restore()
    }

    let raf = 0
    let t0 = 0
    let left = false
    const frame = (stamp: number) => {
      if (!t0) t0 = stamp
      const now = stamp - t0
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const burst = clamp((now - RING) / (END - RING))
      const r = ringR * (1 - 0.12 * clamp((now - 1300) / 600)) + burst * burst * unit * 0.9
      const alpha = 1 - burst

      // speed lines while they cross
      const streak = clamp(1 - Math.abs(now - 500) / 600)
      if (streak > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.035 * streak})`
        ctx.lineWidth = 1
        for (let i = 0; i < 18; i++) {
          const y = ((i * 97) % 100) / 100 * h
          const x = ((now * (1.4 + (i % 4) * 0.5) + i * 211) % (w + 400)) - 200
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x - 160 - (i % 3) * 60, y)
          ctx.stroke()
        }
      }

      // Grok Bot in the middle grows in as the ring closes
      const hub = ease(clamp((now - 1150) / 500))
      if (hub > 0) {
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(cx, cy + Math.sin(now * 0.006) * 4)
        drawBot('sphere', 'house', unit * 0.2 * (hub + burst * 0.5), true, Math.sin(now * 0.004) * 0.45, -0.1)
        ctx.restore()
      }

      bots.forEach((b, i) => {
        const t = clamp((now - b.start) / FLY)
        if (t <= 0) return
        const target = slot(i, now, r)
        const pos = t < 1 ? bez(b.p0, b.c1, b.c2, target, ease(t)) : target
        const prev = b.trail[b.trail.length - 1] || b.p0
        const vx = pos[0] - prev[0], vy = pos[1] - prev[1]
        const speed = Math.hypot(vx, vy) / Math.max(1, unit * 0.01)
        b.trail.push(pos)
        if (b.trail.length > 10) b.trail.shift()
        if (Math.abs(vx) > 0.5) b.face += (Math.sign(vx) - b.face) * 0.25

        // the trail: one tapered ribbon, thinning out behind
        ctx.save()
        if (b.trail.length > 2) {
          const left: P[] = [], right: P[] = []
          for (let k = 0; k < b.trail.length; k++) {
            const a = b.trail[Math.max(0, k - 1)], c = b.trail[Math.min(b.trail.length - 1, k + 1)]
            const nx = -(c[1] - a[1]), ny = c[0] - a[0]
            const d = Math.hypot(nx, ny) || 1
            const half = (b.size * 0.12 * k) / b.trail.length
            left.push([b.trail[k][0] + (nx / d) * half, b.trail[k][1] + (ny / d) * half])
            right.push([b.trail[k][0] - (nx / d) * half, b.trail[k][1] - (ny / d) * half])
          }
          const tail = b.trail[0], head = b.trail[b.trail.length - 1]
          const g = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1])
          g.addColorStop(0, b.color + '00')
          g.addColorStop(1, b.color + '30')
          ctx.fillStyle = g
          ctx.globalAlpha = alpha
          ctx.beginPath()
          left.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1])
          ctx.closePath()
          ctx.fill()
        }
        ctx.globalAlpha = alpha

        // fly pose: lean into the direction of travel
        const tilt = clamp(Math.atan2(vy, Math.abs(vx) + 0.001), -0.7, 0.7)
        ctx.translate(pos[0], pos[1])
        ctx.scale(b.face, 1)
        ctx.rotate(tilt + 0.14 * Math.min(1, speed))
        // a little stretch along the flight, settling round in the ring
        const st = Math.min(1, speed) * 0.1
        ctx.scale(1 + st, 1 - st * 0.7)
        // eyes ahead while flying, then they all turn to Grok Bot in the middle
        const k = clamp((t - 0.85) / 0.15)
        const dx = cx - pos[0], dy = cy - pos[1], dd = Math.hypot(dx, dy) || 1
        drawBot(b.shape, b.color, b.size, false, 0.6 * (1 - k) + (dx / dd) * Math.sign(b.face || 1) * 0.8 * k, (dy / dd) * 0.7 * k)
        ctx.restore()
      })

      if (now >= END - 220 && !left) {
        left = true
        setLeaving(true)
      }
      if (now >= END) return done.current()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const skip = () => {
      cancelAnimationFrame(raf)
      done.current()
    }
    addEventListener('keydown', skip)
    canvas.addEventListener('pointerdown', skip)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('keydown', skip)
      canvas.removeEventListener('pointerdown', skip)
    }
  }, [])

  return (
    <div className={`intro ${leaving ? 'out' : ''}`} aria-hidden="true">
      <canvas ref={ref} />
      <span className="intro-word">GrokGrid</span>
    </div>
  )
}
