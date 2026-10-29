import type { Shape } from './BotMark'

// Eyes painted on a ball. Each bot's face is treated as a sphere: the two pill eyes sit on
// its surface, the ball turns toward where the bot is looking, and the eyes are projected
// back flat. So a sideways look slides the eyes over, tilts them on a diagonal and squeezes
// the far one, the way the official Grok Bot looks around.

// face centre and radius for each body, in the 0..100 viewBox
export const FACE: Record<Shape, [number, number, number]> = {
  sphere: [50, 50, 44],
  squircle: [50, 50, 42],
  tile: [51, 52, 41],
  cloud: [52, 56, 34],
  cone: [50, 64, 30],
  drop: [50, 64, 34],
}

// one eye in face units (radius 1): centre x, centre y (down is +), half width, half height
const EYE_X = 0.27
const EYE_Y = -0.06
const HALF_W = 0.15
const HALF_H = 0.33
const N = 32 // outline points per eye

export const MAX_LOOK = 0.62 // radians the ball turns at most

/** The two eye outlines as SVG path data for a bot looking toward (lx, ly), each -1..1. */
export function eyePaths(shape: Shape, lx: number, ly: number, scale = 1, open = 1): [string, string] {
  const [cx, cy, r] = FACE[shape]
  const yaw = lx * MAX_LOOK
  const pitch = ly * MAX_LOOK
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const out: string[] = []
  for (const side of [-1, 1]) {
    let d = ''
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2
      // a pill: two half circles joined by straight sides
      const s = Math.sin(a)
      const ux = Math.cos(a) * HALF_W * scale
      const uy = (s * HALF_W + Math.sign(s) * (HALF_H - HALF_W)) * scale * open
      let x = side * EYE_X + ux
      let y = EYE_Y + uy
      let z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      // turn the ball: yaw about the vertical axis, then pitch about the horizontal one
      const x1 = x * cyw + z * syw
      const z1 = -x * syw + z * cyw
      const y2 = y * cp + z1 * sp
      x = x1
      y = y2
      d += `${k ? 'L' : 'M'}${(cx + x * r).toFixed(2)} ${(cy + y * r).toFixed(2)}`
    }
    out.push(d + 'Z')
  }
  return out as [string, string]
}

/** Eye colour for a body colour: near black on light and coloured bots, white on the black one. */
export function eyeInk(color: string) {
  return color === '#0b0b0b' || color === '#000' || color === '#000000' ? '#ffffff' : '#1a1a1a'
}

// ---------- the one clock every live bot shares ----------

export interface Looker {
  el: HTMLElement
  paths: [SVGPathElement, SVGPathElement]
  shape: Shape
  doze?: boolean
  // eased state
  lx: number
  ly: number
  sc: number
  // idle glance
  gx: number
  gy: number
  until: number
  next: number
}

const lookers = new Set<Looker>()
let raf = 0
let px = -1e4, py = -1e4, lastMove = -1e9
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function onMove(e: PointerEvent) {
  px = e.clientX
  py = e.clientY
  lastMove = performance.now()
}

function tick(now: number) {
  raf = lookers.size ? requestAnimationFrame(tick) : 0
  if (document.hidden) return
  const active = now - lastMove < 1600 // the pointer moved lately: everyone watches it
  for (const b of lookers) {
    const r = b.el.getBoundingClientRect()
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue
    const bx = r.left + r.width / 2, by = r.top + r.height / 2
    const dx = px - bx, dy = py - by
    const dist = Math.hypot(dx, dy)
    const near = dist < r.width * 0.6 // the pointer is on it
    let tx = 0, ty = 0, ts = 1
    if (near) {
      // attentive: eyes come nearly front on, a little bigger, still following
      tx = (dx / (r.width * 0.6)) * 0.35
      ty = (dy / (r.width * 0.6)) * 0.35
      ts = 1.1
    } else if (active) {
      const k = Math.min(1, dist / 260)
      tx = (dx / (dist || 1)) * k
      ty = (dy / (dist || 1)) * k * 0.8
    } else {
      // on its own: a glance somewhere every few seconds, hold, come back
      if (now > b.next) {
        const a = Math.random() * Math.PI * 2
        b.gx = Math.cos(a) * (0.55 + Math.random() * 0.4)
        b.gy = Math.sin(a) * 0.6
        b.until = now + 700 + Math.random() * 600
        b.next = now + 2200 + Math.random() * 1600
      }
      if (now < b.until) { tx = b.gx; ty = b.gy }
    }
    // smooth, a touch springy
    b.lx += (tx - b.lx) * 0.12
    b.ly += (ty - b.ly) * 0.12
    b.sc += (ts - b.sc) * 0.15
    const [a1, a2] = eyePaths(b.shape, b.lx, b.ly, b.sc, b.doze && !near ? 0.22 : 1)
    b.paths[0].setAttribute('d', a1)
    b.paths[1].setAttribute('d', a2)
    // the whole face drifts a little the same way
    b.el.style.setProperty('--lx', b.lx.toFixed(3))
    b.el.style.setProperty('--ly', b.ly.toFixed(3))
  }
}

/** Start a bot looking around. Returns the stop function. */
export function watch(el: HTMLElement, paths: [SVGPathElement, SVGPathElement], shape: Shape, doze = false) {
  if (still) return () => {}
  const b: Looker = { el, paths, shape, doze, lx: 0, ly: 0, sc: 1, gx: 0, gy: 0, until: 0, next: performance.now() + Math.random() * 2500 }
  if (!lookers.size) addEventListener('pointermove', onMove, { passive: true })
  lookers.add(b)
  if (!raf) raf = requestAnimationFrame(tick)
  return () => {
    lookers.delete(b)
    if (!lookers.size) removeEventListener('pointermove', onMove)
  }
}
