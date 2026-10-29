// Shared motion-design kit for every GrokGrid video. Everything is a pure function of time: seek(t) lays out the frame at t.
// Open index.html?w=1920&h=1080 (wide) or ?w=1080&h=1920 (vertical), &cut=<name> picks cuts/<name>.js. render.js steps seek().
const Q = new URLSearchParams(location.search)
const W = +(Q.get('w') || 1920), H = +(Q.get('h') || 1080)
const V = H > W // vertical cut
const FPS = 30
const UI = Q.get('ui') || '../ui2'
const CLIPS = Q.get('clips') || '../clips'
const L = (wide, vert) => (V ? vert : wide)

// ---------- maths ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const lerp = (a, b, t) => a + (b - a) * t
const rng = (t, a, b) => clamp((t - a) / (b - a))
const eOut = (x, p = 3) => 1 - Math.pow(1 - clamp(x), p)
const eIn = (x, p = 3) => Math.pow(clamp(x), p)
const eInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const expoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(x)))
const backOut = (x, s = 1.6) => { x = clamp(x) - 1; return x * x * ((s + 1) * x + s) + 1 }
// a springy 0->1 used for pops
const pop = (x) => { x = clamp(x); return 1 - Math.exp(-6 * x) * Math.cos(9 * x) }

// ---------- dom ----------
const stage = document.getElementById('stage')
stage.style.width = W + 'px'
stage.style.height = H + 'px'
function el(tag, cls, parent, html) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  ;(parent || stage).appendChild(e)
  return e
}
function css(e, o) { for (const k in o) e.style[k] = o[k] }
function place(e, x, y, w, h) { css(e, { left: x + 'px', top: y + 'px', ...(w != null ? { width: w + 'px' } : {}), ...(h != null ? { height: h + 'px' } : {}) }) }

// kinetic words: each word rises out of a blur, one after another
function words(parent, html, cls) {
  const box = el('div', cls, parent)
  // keep <span class=..> highlights: split text nodes into words, keep spans as single words
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const out = []
  tmp.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      n.textContent.split(/(\s+)/).forEach((p) => {
        if (!p) return
        if (/^\s+$/.test(p)) { box.appendChild(document.createTextNode(' ')); return }
        const s = el('span', 'w', box); s.textContent = p; out.push(s)
      })
    } else if (n.nodeName === 'BR') {
      box.appendChild(document.createElement('br'))
    } else {
      const s = el('span', 'w ' + (n.className || ''), box); s.innerHTML = n.innerHTML; out.push(s)
    }
  })
  box._w = out
  return box
}
// show words from t0, one every gap seconds; out at t1 (all rise away together)
function playWords(box, t, t0, gap = 0.09, t1 = 1e9, dist = 0.5) {
  box._w.forEach((s, i) => {
    const a = rng(t, t0 + i * gap, t0 + i * gap + 0.55)
    const o = rng(t, t1 + i * 0.03, t1 + i * 0.03 + 0.35)
    const k = expoOut(a)
    const y = (1 - k) * dist - eIn(o) * 0.35
    css(s, { transform: `translateY(${y}em)`, opacity: (clamp(a * 2.2) * (1 - o)).toFixed(3), filter: `blur(${((1 - k) * 10 + o * 8).toFixed(2)}px)` })
  })
  return box
}

// ---------- the bot mark (same geometry as the site's BotMark/eyes.ts) ----------
const BODY = {
  sphere: 'M50 6a44 44 0 1 1 0 88a44 44 0 1 1 0-88z',
  squircle: 'M30 8h40c16 0 24 8 24 24v36c0 16-8 24-24 24H30C14 92 6 84 6 68V32C6 16 14 8 30 8z',
  tile: 'M28 12l46-4c12-1 20 6 20 18l-2 40c-1 14-9 22-22 24l-40 4C18 95 8 88 8 74V34c0-12 8-21 20-22z',
  cloud: 'M30 30a20 20 0 0 1 36-8a18 18 0 0 1 26 18a20 20 0 0 1-6 38H22a18 18 0 0 1-6-34a16 16 0 0 1 14-14z',
  cone: 'M50 8c6 0 10 6 14 14l26 56c4 10-2 16-12 16H22c-10 0-16-6-12-16l26-56c4-8 8-14 14-14z',
  drop: 'M54 8c4 0 8 4 14 14c14 22 22 36 22 48a40 40 0 0 1-80 0c0-18 22-38 34-54c4-6 6-8 10-8z',
}
const FACE = { sphere: [50, 50, 44], squircle: [50, 50, 42], tile: [51, 52, 41], cloud: [52, 56, 34], cone: [50, 64, 30], drop: [50, 64, 34] }
function eyePaths(shape, lx, ly, open = 1) {
  const [cx, cy, r] = FACE[shape]
  const yaw = lx * 0.62, pitch = ly * 0.62
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  const out = []
  for (const side of [-1, 1]) {
    let d = ''
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2
      const s = Math.sin(a)
      const ux = Math.cos(a) * 0.15
      const uy = s * 0.15 * Math.min(1, open * 1.6) + Math.sign(s) * Math.max(0, 0.33 * open - 0.15)
      let x = side * 0.27 + ux, y = -0.06 + uy
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw
      const y2 = y * cp + z1 * sp
      d += `${k ? 'L' : 'M'}${(cx + x1 * r).toFixed(2)} ${(cy + y2 * r).toFixed(2)}`
    }
    out.push(d + 'Z')
  }
  return out
}
const FAMILY = [
  ['#0b0b0b', 'sphere'], ['#ff6a00', 'sphere'], ['#ff9a00', 'cloud'], ['#13b8a6', 'squircle'], ['#9b5cff', 'tile'],
  ['#1683ff', 'squircle'], ['#ff2e9a', 'cone'], ['#7a7a7a', 'drop'], ['#9a6a3f', 'sphere'],
]
function markSVG(color, shape, lx = 0.45, ly = -0.35, open = 1) {
  const house = color === 'house'
  const ink = house ? '#1a1a1a' : color === '#0b0b0b' ? '#f2f2f2' : '#1a1a1a'
  const fill = house ? '#ffffff' : color
  const stroke = color === '#0b0b0b' ? ' stroke="rgba(255,255,255,.28)" stroke-width="1.6"' : ''
  const [a, b] = eyePaths(shape, lx, ly, open)
  return `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="${BODY[shape]}" fill="${fill}"${stroke}/><path d="${a}" fill="${ink}"/><path d="${b}" fill="${ink}"/></svg>`
}

// ---------- character clips (Blender PNG sequences) ----------
const CLIP = {
  hero: { n: 91, size: [960, 960] }, phone: { n: 121, size: [960, 960] }, face: { n: 91, size: [960, 960] },
  lineup: { n: 91, size: [1600, 900] }, lineup_v: { n: 91, size: [960, 960] }, family_run: { n: 106, size: [1600, 900] },
}
const pad = (n) => String(n).padStart(4, '0')
function clipImg(name) {
  const im = el('img', 'clip')
  im._clip = name
  im.style.visibility = 'hidden'
  im.onload = () => (im.style.visibility = 'visible')
  im.onerror = () => (im.style.visibility = 'hidden')
  return im
}
// play clip name from t0; holds the last frame after it ends
function playClip(im, t, t0, opts = {}) {
  const c = CLIP[im._clip]
  let f = Math.floor((t - t0) * FPS)
  if (opts.loop) f = ((f % c.n) + c.n) % c.n
  f = clamp(f, 0, c.n - 1)
  const src = `${CLIPS}/${im._clip}/f_${pad(f)}.png`
  if (im._src !== src) { im.src = src; im._src = src }
}

// ---------- background ----------
const bg = el('div', 'layer')
const grid = el('div', 'bg-grid', bg)
const glow = el('div', 'bg-glow', bg)
const grainC = el('canvas', 'grain', bg)
grainC.width = 480; grainC.height = Math.round(480 * H / W)
css(grainC, { width: '100%', height: '100%' })
const gctx = grainC.getContext('2d')
function grain(seed) {
  const img = gctx.createImageData(grainC.width, grainC.height)
  let s = seed * 9301 + 49297
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const v = (s >> 16) & 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  gctx.putImageData(img, 0, 0)
}
el('div', 'bg-vig', bg)

// ---------- cursor ----------
const cursor = el('div', 'cursor', stage, '<svg viewBox="0 0 34 40" width="34" height="40"><path d="M3 3 L3 33 L11 25.5 L16.5 37 L22 34.5 L16.5 23.5 L27 23.5 Z" fill="#fff" stroke="#0a0a0a" stroke-width="2.4" stroke-linejoin="round"/></svg>')
const ripple = el('div', 'ripple')
// path: list of [time, x, y]; clicks: list of times
function runCursor(t, path, clicks) {
  if (!path || t < path[0][0] - 0.4 || t > path[path.length - 1][0] + 0.5) { css(cursor, { opacity: 0 }); css(ripple, { opacity: 0 }); return }
  let x = path[0][1], y = path[0][2]
  for (let i = 0; i < path.length - 1; i++) {
    const [ta, xa, ya] = path[i], [tb, xb, yb] = path[i + 1]
    if (t >= ta) { const k = eInOut(rng(t, ta, tb)); x = lerp(xa, xb, k); y = lerp(ya, yb, k) }
  }
  const fadeIn = rng(t, path[0][0] - 0.4, path[0][0])
  const fadeOut = 1 - rng(t, path[path.length - 1][0] + 0.15, path[path.length - 1][0] + 0.5)
  let press = 1, rip = null
  for (const c of clicks || []) {
    const d = t - c
    if (d > -0.12 && d < 0.18) press = 1 - 0.18 * Math.sin(clamp((d + 0.12) / 0.3) * Math.PI)
    if (d >= 0 && d < 0.55) rip = d / 0.55
  }
  css(cursor, { opacity: Math.min(fadeIn, fadeOut), transform: `translate(${x}px, ${y}px) scale(${press})`, left: '0px', top: '0px' })
  if (rip != null) css(ripple, { opacity: (1 - rip) * 0.9, left: x + 3 + 'px', top: y + 3 + 'px', transform: `scale(${0.3 + eOut(rip) * 0.9})` })
  else css(ripple, { opacity: 0 })
}

// ---------- browser window with a real screenshot ----------
function windowCard(parent, shot, url = 'grokgrid.fun') {
  const w = el('div', 'window', parent)
  const bar = el('div', 'bar', w)
  el('div', 'dot', bar); el('div', 'dot', bar); el('div', 'dot', bar)
  el('div', 'url', bar, `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5" width="8" height="6" rx="1.5" fill="currentColor"/><path d="M4 5V3.6a2 2 0 0 1 4 0V5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>${url}`)
  const sh = el('div', 'shot', w)
  const im = el('img', '', sh)
  im.src = `${UI}/${shot}.png`
  w._img = im
  w._shots = [im]
  return w
}
// vertical cut: the site's real mobile layout in a phone
function phoneCard(parent, shot) {
  const w = el('div', 'window phonecard', parent)
  const sh = el('div', 'shot', w)
  const im = el('img', '', sh)
  im.src = `${UI}/${shot}.png`
  w._img = im
  w._shots = [im]
  return w
}
function addShot(w, shot) {
  const im = el('img', '', w.querySelector('.shot'))
  im.src = `${UI}/${shot}.png`
  w._shots.push(im)
  return im
}

// =====================================================================
// SCENES. Each: [start, end, build() -> update(t)] with t in absolute seconds.
// =====================================================================
const SCENES = []
function scene(t0, t1, build) {
  const root = el('div', 'scene')
  const update = build(root, t0, t1)
  SCENES.push({ t0, t1, root, update })
}

// ---------- the real UI, redrawn as code ----------
// scripts/snapshot.js saves each page's real markup and stylesheet; ui.js rebuilds it in a shadow root.
// So every card, number, chart and button here is the site's own DOM and CSS: crisp at any zoom, and
// animated piece by piece. A "camera" (translate + scale) moves over it like over a design file.
const UIDIR = Q.get('uidom') || '../ui-dom'
const UI_LOADS = []
function uiView(parent, snap) {
  const wrap = el('div', 'abs', parent)
  css(wrap, { inset: '0', overflow: 'hidden' })
  const host = el('div', 'abs', wrap)
  css(host, { left: '0', top: '0', transformOrigin: '0 0' })
  const v = { wrap, host, sr: null, rects: {}, h: 0 }
  UI_LOADS.push(window.siteUI(host, snap, UIDIR).then((sr) => {
    v.sr = sr
    // the room is drawn by Blender here; its HTML monitor and background stay out
    const st = document.createElement('style')
    st.textContent = `.mon, .stage canvas { display: none !important; } :host, .gg-body, .app { background: transparent !important; } .page { overflow: visible !important; }
    .page, .pg > *, .pg-sub, .pg-eyebrow, .pg-title, .pg-title span, .st-hero > *, .pg-sec .card, .pn-item, .lb, aside.panel { animation-name: none !important; }`
    sr.appendChild(st)
    const pg = sr.querySelector('.page')
    v.h = Math.max(host._snap.vh, pg ? pg.scrollHeight : 0)
    css(host, { width: host._snap.vw + 'px', height: v.h + 'px' })
  }))
  return v
}
const $ = (v, sel) => (v.sr ? v.sr.querySelector(sel) : null)
const $$ = (v, sel) => (v.sr ? [...v.sr.querySelectorAll(sel)] : [])
// an element's box in UI pixels (measured once with the camera at rest)
function box(v, key, sel, nth = 0) {
  if (v.rects[key]) return v.rects[key]
  const e = $$(v, sel)[nth]
  if (!e) return { x: 0, y: 0, w: 0, h: 0 }
  const keep = v.host.style.transform
  v.host.style.transform = 'none'
  const hr = v.host.getBoundingClientRect(), r = e.getBoundingClientRect()
  v.host.style.transform = keep
  return (v.rects[key] = { x: r.x - hr.x, y: r.y - hr.y, w: r.width, h: r.height })
}
// camera keys: [t, cx, cy, scale] with cx, cy the UI point at the centre of the frame
function camera(v, t, keys) {
  // the page's full height can only be read once its scene is showing
  if (!v.sized) {
    const pg = $(v, '.page')
    if (pg && pg.scrollHeight) { v.h = Math.max(v.host._snap.vh, pg.scrollHeight); css(v.host, { height: v.h + 'px' }); v.sized = true }
  }
  let [, cx, cy, sc] = keys[0]
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, xa, ya, sa] = keys[i], [tb, xb, yb, sb] = keys[i + 1]
    if (t >= ta) { const k = eInOut(rng(t, ta, tb)); cx = lerp(xa, xb, k); cy = lerp(ya, yb, k); sc = lerp(sa, sb, k) }
  }
  v.cam = [cx, cy, sc]
  css(v.host, { transform: `translate(${W / 2 - cx * sc}px, ${H / 2 - cy * sc}px) scale(${sc})` })
}
// a UI point on stage under the current camera
const onStage = (v, x, y) => [W / 2 + (x - v.cam[0]) * v.cam[2], H / 2 + (y - v.cam[1]) * v.cam[2]]
const centre = (v, b, fx = 0.5, fy = 0.5) => onStage(v, b.x + b.w * fx, b.y + b.h * fy)
// rise-in for a list of elements, one after another
function cascade(els, t, t0, gap, dist = 36) {
  els.forEach((e, i) => {
    const k = expoOut(rng(t, t0 + i * gap, t0 + i * gap + 0.6))
    e.style.opacity = clamp(k * 1.6)
    e.style.transform = `translateY(${(1 - k) * dist}px)`
  })
}
const fmt = (x, d) => x.toFixed(d)
let CURSOR = null

// the page's own title block rises in as the scene starts (the site's entrance, driven by video time)
const pageIn = (v, t, t0) => cascade($$(v, '.pg > *').slice(0, 4), t, t0, 0.09, 30)

