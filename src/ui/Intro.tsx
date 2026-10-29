import { useEffect, useRef, useState } from 'react'
import { BODY, FAMILY, type Shape } from './BotMark'
import { eyeInk, eyePaths } from './eyes'
import './intro.css'

// The opening: the whole bot family flies across the screen like Superman, leaning in,
// swoops back and circles up around Grok Bot, then the ring bursts and shows the room.
// The friends watch the pointer on the way in. A click, Enter or Space skips ahead.
const FLY = 1050 // ms each bot spends crossing and swooping into the ring
const STAGGER = 42
const SETTLE = 1900 // the ring has closed: it bursts on its own here
const OUT = 520 // the burst

const BOTS: { color: string; shape: Shape }[] = [
  ...FAMILY.filter((f) => f.name !== 'black'),
  { color: '#ff6a00', shape: 'squircle' },
  { color: '#13b8a6', shape: 'cone' },
  { color: '#9b5cff', shape: 'sphere' },
  { color: '#1683ff', shape: 'drop' },
]

// once per browser session: switching pages or reloading never replays it
const SEEN = 'gg-intro'
export const introDue = () => {
  try { return !sessionStorage.getItem(SEEN) } catch { return true }
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
const lerp = (rate: number, dt: number) => 1 - Math.pow(1 - rate, dt / 16.67)

export function Intro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(onDone)
  const enter = useRef<() => void>(() => {})
  useEffect(() => { done.current = onDone })

  useEffect(() => {
    try { sessionStorage.setItem(SEEN, '1') } catch { /* private mode: it just plays again */ }
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return done.current()
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(devicePixelRatio || 1, 2)
    let w = 0, h = 0, cx = 0, cy = 0, unit = 0, ringR = 0
    const size = () => {
      w = innerWidth
      h = innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      cx = w / 2
      cy = h / 2
      unit = Math.min(w, h)
      ringR = unit * 0.28
    }
    size()
    const n = BOTS.length
    const paths = Object.fromEntries(Object.entries(BODY).map(([k, d]) => [k, new Path2D(d)])) as Record<Shape, Path2D>

    // each bot's flight: in from one edge, across past the middle, back round into its slot
    const bots = BOTS.map((b, i) => {
      const fromLeft = i % 2 === 0
      const y0 = (i * 0.37) % 0.76
      return {
        ...b,
        k: 0.088 + ((i * 0.13) % 0.03),
        start: i * STAGGER,
        fromLeft,
        y0,
        trail: [] as P[],
        face: fromLeft ? 1 : -1,
        // waiting in the ring: a pull toward the pointer, a hop, eyes and blinks
        ox: 0, oy: 0, lx: 0, ly: 0, hop: -1e9, near: false,
        blinkAt: 2400 + Math.random() * 3000, blinkEnd: 0,
      }
    })
    const hub = { lx: 0, ly: 0, ox: 0, oy: 0, blinkAt: 3000, blinkEnd: 0 }

    let px = -1e4, py = -1e4, moved = -1e9
    const onMove = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      moved = performance.now()
    }
    // a tap anywhere makes the friends hop
    const onTap = (e: PointerEvent) => {
      onMove(e)
      const now = performance.now() - t0
      for (const b of bots) b.hop = Math.max(b.hop, now - Math.random() * 120)
      enter.current()
    }

    const slot = (i: number, ang: number, r: number): P => {
      const a = (i / n) * Math.PI * 2 + ang
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92]
    }

    // flat matte bodies with the same ball-painted eyes as the rest of the site
    const drawBot = (shape: Shape, color: string, s: number, house: boolean, lx = 0, ly = 0, open = 1) => {
      ctx.save()
      ctx.scale(s / 100, s / 100)
      ctx.translate(-50, -50)
      ctx.fillStyle = house ? '#ffffff' : color
      ctx.fill(paths[shape])
      ctx.fillStyle = house ? '#1a1a1a' : eyeInk(color)
      for (const d of eyePaths(shape, lx, ly, 1, open)) ctx.fill(new Path2D(d))
      ctx.restore()
    }
    const blink = (b: { blinkAt: number; blinkEnd: number }, now: number) => {
      if (now > b.blinkAt) {
        b.blinkEnd = now + 140
        b.blinkAt = now + (Math.random() < 0.15 ? 260 : 2600 + Math.random() * 3600)
      }
      return now < b.blinkEnd ? 0.12 : 1
    }

    let raf = 0
    let t0 = 0
    let last = 0
    let ang = 0
    let enteredAt = -1
    let left = false
    const frame = (stamp: number) => {
      if (!t0) t0 = stamp - (still ? SETTLE : 0)
      const now = stamp - t0
      const dt = Math.min(64, now - (last || now))
      last = now
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      if (enteredAt < 0 && now > SETTLE) enter.current()
      const burst = enteredAt < 0 ? 0 : clamp((now - enteredAt) / OUT)
      const r = ringR * (1 - 0.12 * clamp((now - 1300) / 600)) + burst * burst * unit * 0.9
      const alpha = 1 - burst
      // fast while they fly in, then a slow drift
      const settled = clamp((now - 1500) / 900)
      ang += dt * (still ? 0 : 0.0024 + (0.00028 - 0.0024) * settled)
      const pointer = now >= 1200 && stamp - moved < 3500 && enteredAt < 0

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

      // Grok Bot in the middle grows in as the ring closes, and watches the pointer too
      const grow = ease(clamp((now - 1150) / 500))
      if (grow > 0) {
        const dx = px - cx, dy = py - cy, dd = Math.hypot(dx, dy) || 1
        const k = Math.min(1, dd / (unit * 0.25))
        const tx = pointer ? (dx / dd) * k * 0.85 : Math.sin(now * 0.0012) * 0.45
        const ty = pointer ? (dy / dd) * k * 0.7 : -0.1
        hub.lx += (tx - hub.lx) * lerp(0.12, dt)
        hub.ly += (ty - hub.ly) * lerp(0.12, dt)
        hub.ox += ((pointer ? (dx / dd) * Math.min(dd * 0.04, unit * 0.02) : 0) - hub.ox) * lerp(0.06, dt)
        hub.oy += ((pointer ? (dy / dd) * Math.min(dd * 0.04, unit * 0.02) : 0) - hub.oy) * lerp(0.06, dt)
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(cx + hub.ox, cy + hub.oy + Math.sin(now * 0.0028) * 4)
        drawBot('sphere', 'house', unit * 0.2 * (grow + burst * 0.5), true, hub.lx, hub.ly, blink(hub, now))
        ctx.restore()
      }

      bots.forEach((b, i) => {
        const t = clamp((now - b.start) / FLY)
        if (t <= 0) return
        const s = unit * b.k
        const home = slot(i, ang, r)
        // waiting: lean toward a pointer that comes near, and hop when it reaches
        const dx = px - home[0], dy = py - home[1], dd = Math.hypot(dx, dy) || 1
        const reach = unit * 0.32
        const pull = pointer && t >= 1 ? Math.exp(-dd / reach) * Math.min(dd * 0.5, s * 0.7) : 0
        b.ox += ((dx / dd) * pull - b.ox) * lerp(0.08, dt)
        b.oy += ((dy / dd) * pull - b.oy) * lerp(0.08, dt)
        const close = pointer && dd < s * 1.1
        if (close && !b.near) b.hop = now
        b.near = close
        const hopT = clamp((now - b.hop) / 420)
        const hopY = hopT < 1 ? -Math.sin(hopT * Math.PI) * s * 0.32 : 0
        const bob = t >= 1 && !still ? Math.sin(now * 0.0021 + i * 1.7) * s * 0.06 : 0
        const target: P = [home[0] + b.ox, home[1] + b.oy + bob + hopY]

        const p0: P = [b.fromLeft ? -s * 2 : w + s * 2, h * (0.12 + b.y0)]
        const c1: P = [b.fromLeft ? w * 1.05 : -w * 0.05, p0[1] + (i % 3 - 1) * h * 0.12]
        const c2: P = [b.fromLeft ? cx + w * 0.35 : cx - w * 0.35, cy + (i % 2 ? -1 : 1) * h * 0.35]
        const pos = t < 1 ? bez(p0, c1, c2, target, ease(t)) : target
        const prev = b.trail[b.trail.length - 1] || p0
        const vx = pos[0] - prev[0], vy = pos[1] - prev[1]
        const speed = t < 1 ? Math.hypot(vx, vy) / Math.max(1, unit * 0.01) : 0
        b.trail.push(pos)
        if (b.trail.length > 10) b.trail.shift()
        if (t < 1 && Math.abs(vx) > 0.5) b.face += (Math.sign(vx) - b.face) * 0.25
        // in the ring they all stand facing out, so the eyes do the turning
        if (t >= 1) b.face += (1 - b.face) * lerp(0.1, dt)

        // the trail: one tapered ribbon, thinning out behind, only while flying
        ctx.save()
        if (t < 1 && b.trail.length > 2) {
          const lf: P[] = [], rt: P[] = []
          for (let k = 0; k < b.trail.length; k++) {
            const a = b.trail[Math.max(0, k - 1)], c = b.trail[Math.min(b.trail.length - 1, k + 1)]
            const nx = -(c[1] - a[1]), ny = c[0] - a[0]
            const d = Math.hypot(nx, ny) || 1
            const half = (s * 0.12 * k) / b.trail.length
            lf.push([b.trail[k][0] + (nx / d) * half, b.trail[k][1] + (ny / d) * half])
            rt.push([b.trail[k][0] - (nx / d) * half, b.trail[k][1] - (ny / d) * half])
          }
          const tail = b.trail[0], head = b.trail[b.trail.length - 1]
          const g = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1])
          g.addColorStop(0, b.color + '00')
          g.addColorStop(1, b.color + '30')
          ctx.fillStyle = g
          ctx.globalAlpha = alpha
          ctx.beginPath()
          lf.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          for (let k = rt.length - 1; k >= 0; k--) ctx.lineTo(rt[k][0], rt[k][1])
          ctx.closePath()
          ctx.fill()
        }
        ctx.globalAlpha = alpha

        // fly pose: lean into the direction of travel; waiting: a small lean toward the pointer
        const tilt = t < 1 ? clamp(Math.atan2(vy, Math.abs(vx) + 0.001), -0.7, 0.7) : clamp(b.ox / Math.max(1, s), -0.5, 0.5) * 0.35
        ctx.translate(pos[0], pos[1])
        ctx.scale(Math.abs(b.face) < 0.05 ? 0.05 : b.face, 1)
        ctx.rotate(tilt + 0.14 * Math.min(1, speed))
        // a stretch along the flight, a squash on landing a hop
        const st = Math.min(1, speed) * 0.1
        const squash = hopT > 0.85 && hopT < 1 ? Math.sin(((hopT - 0.85) / 0.15) * Math.PI) * 0.1 : 0
        ctx.scale(1 + st + squash, 1 - st * 0.7 - squash)

        // eyes: ahead while flying, then to Grok Bot, then wherever the pointer goes
        let tx: number, ty: number
        if (t < 1) {
          const k = clamp((t - 0.85) / 0.15)
          const hx = cx - pos[0], hy = cy - pos[1], hd = Math.hypot(hx, hy) || 1
          tx = 0.6 * (1 - k) + (hx / hd) * Math.sign(b.face || 1) * 0.8 * k
          ty = (hy / hd) * 0.7 * k
          b.lx = tx
          b.ly = ty
        } else {
          if (pointer) {
            const ex = px - pos[0], ey = py - pos[1], ed = Math.hypot(ex, ey) || 1
            const k = Math.min(1, ed / (s * 1.3))
            tx = (ex / ed) * k * 0.9
            ty = (ey / ed) * k * 0.75
          } else {
            const hx = cx - pos[0], hy = cy - pos[1], hd = Math.hypot(hx, hy) || 1
            tx = (hx / hd) * 0.8
            ty = (hy / hd) * 0.7
          }
          b.lx += (tx - b.lx) * lerp(0.16, dt)
          b.ly += (ty - b.ly) * lerp(0.16, dt)
        }
        drawBot(b.shape, b.color, s * (b.near ? 1.06 : 1), false, b.lx, b.ly, t >= 1 ? blink(b, now) : 1)
        ctx.restore()
      })

      if (enteredAt >= 0 && now >= enteredAt + OUT - 220 && !left) {
        left = true
        setLeaving(true)
      }
      if (enteredAt >= 0 && now >= enteredAt + OUT) return done.current()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    enter.current = () => {
      if (enteredAt >= 0) return
      enteredAt = Math.max(performance.now() - t0, 0)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        enter.current()
      }
    }
    addEventListener('keydown', onKey)
    addEventListener('pointermove', onMove, { passive: true })
    addEventListener('resize', size)
    canvas.addEventListener('pointerdown', onTap)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('keydown', onKey)
      removeEventListener('pointermove', onMove)
      removeEventListener('resize', size)
      canvas.removeEventListener('pointerdown', onTap)
    }
  }, [])

  return (
    <div className={`intro ${leaving ? 'out' : ''}`}>
      <canvas ref={ref} aria-hidden="true" />
      <span className="intro-word" aria-hidden="true">GrokGrid</span>
    </div>
  )
}
