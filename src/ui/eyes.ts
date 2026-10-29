import type { Shape } from './BotMark'

// Eyes painted on a ball. Each bot's face is treated as a sphere: the two pill eyes sit on
// its surface, the ball turns toward where the bot is looking, and the eyes are projected
// back flat. So a sideways look slides the eyes over, tilts them on a diagonal and squeezes
// the far one, the way the official Grok Bot looks around.

// face centre and radius for each body, in the 0..100 viewBox
const FACE: Record<Shape, [number, number, number]> = {
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

const MAX_LOOK = 0.62 // radians the ball turns at most

/** The two eye outlines as SVG path data for a bot looking toward (lx, ly), each -1..1. */
export function eyePaths(shape: Shape, lx: number, ly: number, scale = 1, open = 1, open2 = open): [string, string] {
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
      const o = side < 0 ? open : open2
      // closing squeezes the pill toward a flat line, the round ends staying round
      const uy = (s * HALF_W * Math.min(1, o * 1.6) + Math.sign(s) * Math.max(0, HALF_H * o - HALF_W)) * scale
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
// Timed like the official Grok Bots: the body stays put, the eyes pick somewhere new to look
// every second or so and hold it, slide there in a few hundred milliseconds, blink now and then,
// and watch the pointer only while it is close. Every bot keeps its own clock, so none move in step.

export type Face = 'none' | 'blink' | 'wink' | 'squint' | 'wide' | 'sleepy'
// how open each eye is and how big they get, per face
const FACES: Record<Face, [number, number, number]> = {
  none: [1, 1, 1],
  blink: [0.1, 0.1, 1],
  wink: [1, 0.1, 1.02],
  squint: [0.45, 0.45, 1.03],
  wide: [1.1, 1.1, 1.14],
  sleepy: [0.36, 0.36, 0.98],
}
const FACE_TIME: Record<Face, number> = { none: 0, blink: 140, wink: 520, squint: 1100, wide: 900, sleepy: 1500 }
const MOODS: Face[] = ['wink', 'squint', 'wide', 'sleepy']

// where an idle bot glances: centre, up and to the sides, down; centre comes up most
const GLANCES: [number, number][] = [
  [0, 0], [0.62, -0.42], [0, -0.6], [0, 0.48], [0.72, 0], [-0.6, -0.36], [-0.72, 0.06], [0.42, 0.4], [-0.38, 0.44],
]

export interface Looker {
  el: HTMLElement | SVGSVGElement
  draw: (lx: number, ly: number, sc: number, o1: number, o2: number) => void
  doze?: boolean
  glances: [number, number][]
  reach: number // how far off, in bot widths, the pointer still gets watched
  // eased state
  lx: number
  ly: number
  sc: number
  o1: number
  o2: number
  // a blink every few seconds, and a mood now and then
  blinkAt: number
  blinkEnd: number
  face: Face
  faceUntil: number
  faceNext: number
  // the glance it is holding
  gx: number
  gy: number
  next: number
}

const lookers = new Set<Looker>()
let raf = 0, last = 0
let px = -1e4, py = -1e4, lastMove = -1e9
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function onMove(e: PointerEvent) {
  px = e.clientX
  py = e.clientY
  lastMove = performance.now()
}

// a step of an ease toward a target that runs the same at any frame rate
const lerp = (rate: number, dt: number) => 1 - Math.pow(1 - rate, dt / 16.67)

function tick(now: number) {
  raf = lookers.size ? requestAnimationFrame(tick) : 0
  const dt = Math.min(64, now - (last || now))
  last = now
  if (document.hidden) return
  const pointerOn = now - lastMove < 4000
  for (const b of lookers) {
    const r = b.el.getBoundingClientRect()
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue
    const bx = r.left + r.width / 2, by = r.top + r.height / 2
    const dx = px - bx, dy = py - by
    const dist = Math.hypot(dx, dy)
    const near = dist < r.width * 0.6 // the pointer is on it
    const watching = pointerOn && dist < Math.max(r.width * b.reach, 160)
    let tx: number, ty: number, ts = 1
    if (near) {
      // attentive: eyes come nearly front on, a little bigger, still following
      tx = (dx / (r.width * 0.6)) * 0.35
      ty = (dy / (r.width * 0.6)) * 0.35
      ts = 1.08
    } else if (watching) {
      const k = Math.min(1, dist / (r.width * 1.1))
      tx = (dx / dist) * k * 0.9
      ty = (dy / dist) * k * 0.75
    } else {
      // on its own: somewhere new every second or so, held
      if (now > b.next) {
        const pick = Math.random() < 0.3 ? b.glances[0] : b.glances[1 + Math.floor(Math.random() * (b.glances.length - 1))]
        b.gx = pick[0] + (Math.random() - 0.5) * 0.12
        b.gy = pick[1] + (Math.random() - 0.5) * 0.12
        b.next = now + 1000 + Math.random() * 600
      }
      tx = b.gx
      ty = b.gy
    }
    // a quick blink every few seconds, sometimes two
    if (now > b.blinkAt) {
      b.blinkEnd = now + FACE_TIME.blink
      b.blinkAt = now + (Math.random() < 0.15 ? 260 : 2800 + Math.random() * 3800)
    }
    // a mood once in a while; tiny bots skip them, at that size they read as shut eyes
    if (now > b.faceNext) {
      b.face = r.width < 60 ? 'none' : MOODS[Math.floor(Math.random() * MOODS.length)]
      b.faceUntil = now + FACE_TIME[b.face]
      b.faceNext = now + 8000 + Math.random() * 7000
    }
    if (now > b.faceUntil) b.face = 'none'
    const hoverFace = b.el.dataset.hoverFace as Face | undefined
    const blinking = now < b.blinkEnd
    const face: Face = blinking ? 'blink' : near ? (hoverFace && FACES[hoverFace] ? hoverFace : 'none') : b.face
    const [f1, f2, fs] = FACES[face]
    const ease = lerp(blinking ? 0.55 : 0.14, dt)
    b.o1 += (f1 - b.o1) * ease
    b.o2 += (f2 - b.o2) * ease
    ts *= fs
    const follow = lerp(watching || near ? 0.2 : 0.15, dt)
    b.lx += (tx - b.lx) * follow
    b.ly += (ty - b.ly) * follow
    b.sc += (ts - b.sc) * lerp(0.15, dt)
    const doze = b.doze && !near ? 0.22 : 1
    b.draw(b.lx, b.ly, b.sc, b.o1 * doze, b.o2 * doze)
    // the whole face drifts a little the same way
    b.el.style.setProperty('--lx', b.lx.toFixed(3))
    b.el.style.setProperty('--ly', b.ly.toFixed(3))
  }
}

/** Start something looking around. `draw` paints the eyes each frame. Returns the stop function. */
export function watchWith(el: Looker['el'], draw: Looker['draw'], opts: { doze?: boolean; glances?: [number, number][]; reach?: number } = {}) {
  if (still) return () => {}
  const t = performance.now()
  const b: Looker = {
    el, draw, doze: opts.doze, glances: opts.glances ?? GLANCES, reach: opts.reach ?? 2.5,
    lx: opts.glances?.[0][0] ?? 0, ly: opts.glances?.[0][1] ?? 0, sc: 1, o1: 1, o2: 1,
    blinkAt: t + 1200 + Math.random() * 3500, blinkEnd: 0,
    face: 'none', faceUntil: 0, faceNext: t + 5000 + Math.random() * 9000,
    gx: opts.glances?.[0][0] ?? 0, gy: opts.glances?.[0][1] ?? 0, next: t + 300 + Math.random() * 1200,
  }
  if (!lookers.size) addEventListener('pointermove', onMove, { passive: true })
  lookers.add(b)
  if (!raf) raf = requestAnimationFrame(tick)
  return () => {
    lookers.delete(b)
    if (!lookers.size) removeEventListener('pointermove', onMove)
  }
}

/** Start a bot looking around. Returns the stop function. */
export function watch(el: HTMLElement, paths: [SVGPathElement, SVGPathElement], shape: Shape, doze = false) {
  return watchWith(el, (lx, ly, sc, o1, o2) => {
    const [a1, a2] = eyePaths(shape, lx, ly, sc, o1, o2)
    paths[0].setAttribute('d', a1)
    paths[1].setAttribute('d', a2)
  }, { doze })
}
