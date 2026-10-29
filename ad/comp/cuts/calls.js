// Feature video: "Every trade, called out." The Calls panel, card by card. 104 bpm, scenes land on bar lines.
const DURATION = 21.4
const CB = (60 / 104) * 4 // one bar
const cb = (n) => n * CB // bar line n

// stage styles for the pieces drawn around the site's UI (labels, the pump.fun callout and the X post)
const CALLS_CSS = el('style', '', document.head)
CALLS_CSS.textContent = `
.cs-side { position: absolute; display: inline-flex; align-items: center; height: ${L(96, 96)}px; padding: 0 40px; border-radius: 24px; font: 650 56px 'Geist'; letter-spacing: -0.02em; color: #0a0a0a; white-space: nowrap; transform-origin: 50% 50%; box-shadow: 0 20px 60px rgba(0,0,0,.5); pointer-events: none; }
.cs-side.buy { background: #4ade80; } .cs-side.sell { background: #f87171; }
.cs-lbl { position: absolute; display: flex; align-items: center; gap: 12px; padding: 12px 22px 12px 16px; border-radius: 999px; background: rgba(18,18,19,.94); border: 1px solid rgba(255,255,255,.18);
  font: 500 ${L(32, 36)}px 'Geist'; letter-spacing: -0.02em; color: #fff; white-space: nowrap; box-shadow: 0 14px 40px rgba(0,0,0,.6); pointer-events: none; }
.cs-lbl i { width: 12px; height: 12px; border-radius: 50%; background: #fff; flex: 0 0 auto; }
.cs-lbl.g i { background: #4ade80; box-shadow: 0 0 12px #4ade80; } .cs-lbl.r i { background: #f87171; box-shadow: 0 0 12px #f87171; }
.cs-line { position: absolute; height: 2px; background: rgba(255,255,255,.55); transform-origin: 0 50%; pointer-events: none; }
.cs-dot { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 5px rgba(255,255,255,.18); pointer-events: none; }
.cs-toast { position: absolute; display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-radius: 16px; background: #fff; color: #0a0a0a; font: 600 ${L(26, 30)}px 'Geist'; letter-spacing: -0.02em; white-space: nowrap; box-shadow: 0 20px 60px rgba(0,0,0,.6); pointer-events: none; transform-origin: 0 100%; }
.cs-toast span { font: 500 ${L(20, 24)}px 'Geist Mono'; color: rgba(10,10,10,.55); letter-spacing: 0; }
.cs-card { position: absolute; width: ${L(840, 480)}px; border-radius: 28px; background: rgb(14,14,15); border: 1px solid rgb(38,38,40); box-shadow: 0 40px 120px rgba(0,0,0,.7); overflow: hidden; pointer-events: none; }
.cs-card .top { display: flex; align-items: center; gap: 14px; padding: 20px 26px; border-bottom: 1px solid rgba(255,255,255,.08); font: 500 22px 'Geist Mono'; color: rgba(255,255,255,.55); }
.cs-card .top b { color: #fff; font: 600 22px 'Geist Mono'; }
.cs-card .top .live { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; color: #4ade80; }
.cs-card .top .live:before { content: ''; width: 10px; height: 10px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 10px #4ade80; }
.cs-card .cs-coin { display: flex; align-items: center; gap: 18px; padding: 22px 26px 6px; }
.cs-card .tile { width: 64px; height: 64px; border-radius: 16px; background: rgb(22,131,255); display: grid; place-items: center; font: 600 22px 'Geist Mono'; color: #0a0a0a; flex: 0 0 auto; }
.cs-card .cs-coin b { display: block; font: 600 32px 'Geist'; letter-spacing: -0.03em; }
.cs-card .cs-coin span { font: 500 22px 'Geist Mono'; color: rgb(138,138,144); }
.cs-card .cs-coin .mc { margin-left: auto; text-align: right; }
.cs-card .cs-coin .mc b { font: 600 30px 'Geist Mono'; letter-spacing: 0; }
.cs-card .post { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 18px; padding: 22px 26px 26px; }
.cs-card .av { width: 64px; height: 64px; }
.cs-card .who { display: flex; align-items: center; gap: 10px; font: 600 26px 'Geist'; letter-spacing: -0.02em; }
.cs-card .who span { font: 500 22px 'Geist'; color: rgb(138,138,144); }
.cs-card .who .pill { margin-left: auto; height: 32px; padding: 0 14px; border-radius: 8px; display: inline-flex; align-items: center; font: 650 19px 'Geist'; color: #0a0a0a; }
.cs-card .txt { margin-top: 8px; font: 400 30px 'Geist'; line-height: 1.35; letter-spacing: -0.02em; color: rgb(232,232,234); min-height: ${L(82, 122)}px; white-space: normal; overflow-wrap: anywhere; }
.cs-card .txt .caret { display: inline-block; width: 3px; height: 30px; background: #fff; vertical-align: -4px; margin-left: 2px; }
.cs-card .mini { margin-top: 16px; display: flex; gap: 26px; padding: 16px 20px; border-radius: 16px; background: rgb(25,25,27); font: 600 24px 'Geist'; white-space: nowrap; flex-wrap: wrap; row-gap: 10px; }
.cs-card .mini i { display: block; font: 400 18px 'Geist'; font-style: normal; color: rgb(138,138,144); }
.cs-card .link { margin-top: 14px; font: 500 21px 'Geist Mono'; color: rgb(138,138,144); }
.cs-tagline { position: absolute; padding: 10px 20px; border-radius: 999px; background: #fff; color: #0a0a0a; font: 600 ${L(34, 38)}px 'Geist'; letter-spacing: -0.02em; white-space: nowrap; pointer-events: none; }
`

const ARROW_UP = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>`
const TX_PILL = `<a class="cs-txa" style="margin-left:auto;text-decoration:none;color:inherit"><span class="cc-tx"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>check tx</span></a>`
// every card gets its "check tx" link (how a real trade shows; the snapshot's sample rows have none)
function addTx(v) {
  if (!v.sr) return
  const pb = $(v, '.panel-body')
  if (pb) css(pb, { overflowAnchor: 'none', scrollBehavior: 'auto' })
  if (v._tx) return
  $$(v, '.views, .strip, .calls-dock, .watch').forEach((e) => (e.style.display = 'none'))
  $$(v, '.pn-item .cc-acts').forEach((a) => { a.innerHTML = TX_PILL })
  v._tx = true
}
// a label with a leader line to a point on stage
function label(root, text, cls = '') {
  const ln = el('div', 'cs-line', root), d = el('div', 'cs-dot', root)
  const l = el('div', 'cs-lbl ' + cls, root, '<i></i>' + text)
  return { l, ln, d }
}
function showLabel(o, k, out, tx, ty, lx, ly, side = 'left') {
  const a = clamp(k * 3) * (1 - out)
  // label box is anchored at its left-middle (side 'left') or right-middle ('right'), or centred ('top' / 'bottom')
  const w = o.l.offsetWidth, h = o.l.offsetHeight
  const bx = side === 'right' ? lx - w : side === 'left' ? lx : lx - w / 2
  const by = side === 'top' ? ly - h : side === 'bottom' ? ly : ly - h / 2
  const cx = clamp(bx, 30, W - 30 - w); lx += cx - bx; const bx2 = cx
  css(o.l, { left: bx2 + 'px', top: by + 'px', opacity: a, transform: `scale(${0.7 + 0.3 * pop(k)})`, transformOrigin: side === 'right' ? '100% 50%' : side === 'left' ? '0 50%' : '50% 50%' })
  const len = Math.hypot(lx - tx, ly - ty) * eOut(k)
  const ang = Math.atan2(ly - ty, lx - tx)
  css(o.ln, { left: tx + 'px', top: ty - 1 + 'px', width: len + 'px', transform: `rotate(${ang}rad)`, opacity: a })
  css(o.d, { left: tx + 'px', top: ty + 'px', opacity: a, transform: `scale(${pop(k)})` })
}

// 1. hook: his face, "Every trade, called out." with Buy / Sell tags snapping in on the beat
scene(0, cb(1) + 0.05, (root) => {
  const face = clipImg('face'); root.appendChild(face)
  const fs = L(1000, 1050)
  const head = words(root, L('Every trade,<br><span class="dim">called out.</span>', 'Every trade,<br><span class="dim">called out.</span>'), 'h1 abs')
  css(head, { fontSize: L(150, 140) + 'px', lineHeight: 1.0, textAlign: L('left', 'center') })
  const TAGS = [['buy', 'Buy', 0.58, L(0.66, 0.2), L(0.2, 0.47)], ['sell', 'Sell', 0.865, L(0.86, 0.8), L(0.38, 0.5)], ['buy', 'Buy', 1.15, L(0.6, 0.12), L(0.78, 0.9)], ['sell', 'Sell', 1.44, L(0.88, 0.84), L(0.74, 0.86)]]
  const tags = TAGS.map(([c, txt]) => el('div', 'cs-side ' + c, root, txt))
  return (t) => {
    playClip(face, t, 0)
    const k = expoOut(rng(t, 0, 0.6)), out = eIn(rng(t, cb(1) - 0.25, cb(1)))
    const fx = L(W * 0.74, W * 0.5), fy = L(H * 0.55, H * 0.66)
    const s = fs * (0.9 + 0.1 * k) * (1 + out * 0.5)
    place(face, fx - s / 2, fy - s / 2, s, s)
    css(face, { opacity: k * (1 - out) })
    playWords(head, t, 0.1, 0.1, cb(1) - 0.3)
    if (V) place(head, (W - head.offsetWidth) / 2, 210)
    else place(head, 110, (H - head.offsetHeight) / 2)
    TAGS.forEach(([, , t0, x, y], i) => {
      const p = pop(rng(t, t0, t0 + 0.45))
      const e = tags[i]
      place(e, W * x - e.offsetWidth / 2, H * y - 48)
      css(e, { opacity: clamp(p * 4) * (1 - out), transform: `scale(${p * (1 - out * 0.3)}) rotate(${(i % 2 ? 6 : -6) * (1 - p * 0.6)}deg)`, zIndex: 3 })
    })
  }
})

// 2. the real Calls panel: the list rises in, then new calls land on top, one per beat
let CALLS_VIEW = null
scene(cb(1), cb(3), (root) => {
  const bot = clipImg('phone'); root.appendChild(bot)
  const v = uiView(root, V ? 'm-calls' : 'calls')
  CALLS_VIEW = v
  const head = words(root, L('New calls land<br><span class="hl-gain">on top.</span>', 'New calls land<br><span class="hl-gain">on top.</span>'), 'h1 abs')
  css(head, { fontSize: L(104, 112) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  const LAND = [cb(2) - CB / 2, cb(2) - CB / 4, cb(2)] // items 2, 1, 0 land, the top one on the downbeat
  let H0 = null
  return (t) => {
    if (!v.sr) return
    addTx(v)
    { const w = $(v, '.watch'); if (w) w.style.display = 'none' }
    const items = $$(v, '.pn-item')
    if (!H0) H0 = items.slice(0, 3).map((e, i) => box(v, 'it' + i, '.pn-item', i).h)
    const panel = box(v, 'panel', 'aside.panel'), first = box(v, 'first', '.pn-item')
    const k = expoOut(rng(t, cb(1), cb(1) + 0.7)), out = 0
    const pcx = panel.x + panel.w * 0.5, fcy = first.y + first.h * 0.5
    if (V) camera(v, t, [[cb(1), 215, 470, 2.2], [cb(2), 215, 430, 2.24], [cb(2) + 0.5, 215, 430, 2.24], [cb(3), 215, fcy, 2.75]])
    else camera(v, t, [[cb(1), 1131, 370, 1.72], [cb(2), 1135, 380, 1.78], [cb(2) + 0.5, 1135, 380, 1.78], [cb(3), pcx, fcy, 2.35]])
    if (V) css(v.wrap, { maskImage: 'linear-gradient(transparent 360px, #000 500px)', webkitMaskImage: 'linear-gradient(transparent 360px, #000 500px)' })
    const pe = $(v, 'aside.panel')
    if (pe) css(pe, { transition: 'none', transform: `translateX(${(1 - k) * 460}px)`, opacity: clamp(k * 1.5) })
    // older calls rise in first
    cascade(items.slice(3), t, cb(1) + 0.05, 0.04, 50)
    // the three newest land on top: each one opens a gap and drops in
    ;[2, 1, 0].forEach((i, n) => {
      const e = items[i], c = e.querySelector('.cc')
      const t0 = LAND[n]
      const g = eOut(rng(t, t0 - 0.08, t0 + 0.22), 4), p = pop(rng(t, t0, t0 + 0.55))
      css(e, { transition: t < t0 + 1 ? 'none' : '', height: g < 1 ? H0[i] * g + 'px' : '', marginBottom: g < 1 ? -10 * (1 - g) + 'px' : '', overflow: g < 1 ? 'hidden' : '', opacity: clamp(g * 3) })
      css(c, { transition: t < t0 + 1 ? 'none' : '', transform: `scale(${0.9 + 0.1 * p})`, transformOrigin: '50% 0', borderColor: t > t0 && t < t0 + 0.9 ? `rgb(var(--tone) / ${0.6 * (1 - rng(t, t0 + 0.2, t0 + 0.9))})` : '' })
      const side = e.querySelector('.cc-side')
      const sp = pop(rng(t, t0 + 0.06, t0 + 0.5))
      if (side) css(side, { transition: t < t0 + 1.1 ? 'none' : '', transform: `scale(${t < t0 + 0.06 ? 0.4 : 0.4 + 0.6 * sp})`, boxShadow: t > t0 && t < t0 + 1 ? `0 0 0 ${4 * (1 - rng(t, t0, t0 + 1))}px rgb(var(--tone) / .3), 0 0 18px rgb(var(--tone) / ${0.6 * (1 - rng(t, t0, t0 + 1))})` : '' })
    })
    // him, trading on his phone beside the panel (wide only)
    playClip(bot, t, cb(1), { loop: true })
    const bs = L(1300, 0)
    place(bot, L(-170, 0), L(H - bs * 0.8, 0), bs, bs)
    if (!V) { const pb = $(v, '.panel-body'); if (pb) pb.scrollTop = 0 }
    const bout = eIn(rng(t, cb(2) + 0.4, cb(2) + 1.1))
    css(bot, { opacity: V ? 0 : clamp(k * 2) * (1 - bout), transform: `translateX(${-bout * 200}px)` })
    playWords(head, t, cb(1) + 0.15, 0.1, cb(2) + 0.55)
    if (V) place(head, (W - head.offsetWidth) / 2, 130)
    else place(head, 110, 110)
    void out
  }
})

// 3. inside a call: zoom into the card, hover it, label its parts, check the tx, then the red one
scene(cb(3), cb(5), (root) => {
  const v = uiView(root, V ? 'm-calls' : 'calls')
  const A = 0, B = L(1, 2) // the card we open, then one with the other profit colour
  const gainA = L(true, false)
  const labs = [
    label(root, L('Sell tag', 'Buy tag')),
    label(root, 'his one-line note'),
    label(root, 'size, position, profit', gainA ? 'g' : 'r'),
    label(root, L('SOL in, entry → exit MC', 'SOL out, entry → exit MC')),
  ]
  const toast = el('div', 'cs-toast', root, `${ARROW_UP}opens the tx on Solscan`)
  const red = label(root, L('red when he’s wrong', 'green when he’s right'), L('r', 'g'))
  return (t) => {
    if (!v.sr) return
    addTx(v)
    const ca = box(v, 'ca', '.pn-item .cc', A), cbx = box(v, 'cb', '.pn-item .cc', B)
    const side = box(v, 'side', '.pn-item .cc-side', A), note = box(v, 'note', '.pn-item .cc-note', A)
    const nums = box(v, 'nums', '.pn-item .cc-nums', A), foot = box(v, 'foot', '.pn-item .cc-foot', A)
    const tx = box(v, 'tx', '.pn-item .cc-tx', A), numsB = box(v, 'numsb', '.pn-item .cc-nums', B)
    const pb = $(v, '.panel-body')
    const Smax = pb ? pb.scrollHeight - pb.clientHeight : 0
    const S = V ? Math.max(0, Math.min(cbx.y - ca.y, Smax)) : 0
    const T4_ = cb(4)
    const sc = S * eInOut(rng(t, T4_ + 1.1, T4_ + 1.8))
    if (pb) pb.scrollTop = sc
    const sB = { x: cbx.x, y: cbx.y - sc, w: cbx.w, h: cbx.h }, nB = { x: 0, y: 0, w: 0, h: 0 }
    const acx = ca.x + ca.w / 2, acy = ca.y + ca.h / 2, bcy = cbx.y + cbx.h / 2 - S
    const T = cb(3), T4 = cb(4)
    if (V) camera(v, t, [[T, 215, acy, 2.75], [T + 0.6, 215, acy, 2.42], [T4 - 0.1, 215, acy + 6, 2.45], [T4 + 0.5, tx.x + tx.w / 2 - 40, tx.y, 3.4], [T4 + 1.1, tx.x + tx.w / 2 - 40, tx.y, 3.45], [T4 + 1.8, 215, bcy - 40, 2.45], [cb(5), 215, bcy - 36, 2.5]])
    else camera(v, t, [[T, acx, acy, 2.35], [T + 0.6, acx, acy, 2.55], [T4 - 0.1, acx + 4, acy + 4, 2.6], [T4 + 0.5, tx.x + tx.w / 2 - 60, tx.y, 3.6], [T4 + 1.1, tx.x + tx.w / 2 - 60, tx.y, 3.65], [T4 + 1.8, acx, bcy, 2.55], [cb(5), acx, bcy + 4, 2.62]])
    const cards = $$(v, '.pn-item .cc')
    // the site's hover glow follows the mouse inside the card
    const setMouse = (i, b, mx, my) => { const c = cards[i]; if (c) { c.style.setProperty('--mx', (mx - b.x) + 'px'); c.style.setProperty('--my', (my - b.y) + 'px') } }
    // labels pop in on the beat, out before the tx move
    const BT = CB / 4
    const lo = rng(t, T4 - 0.25, T4)
    const [sx, sy] = centre(v, side, 1.0, 0.5), [nx, ny] = centre(v, note, 0.15, 0.5)
    const [mx, my] = centre(v, nums, 0.85, 0.85), [fx, fy] = centre(v, foot, 0.25, 0.9)
    const [, cTop] = onStage(v, 0, ca.y), [cLeft] = onStage(v, ca.x, 0), [cRight] = onStage(v, ca.x + ca.w, 0), [, cBot] = onStage(v, 0, ca.y + ca.h)
    if (V) {
      showLabel(labs[0], rng(t, T + 0.5, T + 0.85), lo, sx, sy, W - 60, cTop - 60, 'right')
      showLabel(labs[1], rng(t, T + 0.5 + BT, T + 0.85 + BT), lo, nx, ny, 60, cTop - 140, 'left')
      showLabel(labs[2], rng(t, T + 0.5 + 2 * BT, T + 0.85 + 2 * BT), lo, mx, my, W - 60, cBot + 60, 'right')
      showLabel(labs[3], rng(t, T + 0.5 + 3 * BT, T + 0.85 + 3 * BT), lo, fx, fy, 60, cBot + 150, 'left')
    } else {
      showLabel(labs[0], rng(t, T + 0.5, T + 0.85), lo, sx, sy, cRight + 70, sy - 40, 'left')
      showLabel(labs[1], rng(t, T + 0.5 + BT, T + 0.85 + BT), lo, nx, ny, cLeft - 70, ny - 50, 'right')
      showLabel(labs[2], rng(t, T + 0.5 + 2 * BT, T + 0.85 + 2 * BT), lo, mx, my, cRight + 70, my + 30, 'left')
      showLabel(labs[3], rng(t, T + 0.5 + 3 * BT, T + 0.85 + 3 * BT), lo, fx, fy, cLeft - 70, fy + 40, 'right')
    }
    // cursor: rests on the card (real hover), goes to "check tx", clicks, then on to the other colour
    const [hx, hy] = centre(v, ca, 0.62, 0.32)
    const [px, py] = centre(v, tx, 0.5, 0.55)
    Object.assign(nB, numsB, { y: numsB.y - S }); const [bx, by] = centre(v, nB, 0.6, 0.5)
    CURSOR = [[[T + 0.25, hx + 220, hy + 260], [T + 0.8, hx, hy], [T4 - 0.2, hx - 30, hy + 20], [T4 + 0.55, px, py], [T4 + 1.15, px + 2, py + 1], [T4 + 1.8, bx, by], [cb(5), bx + 8, by + 4]], [T4 + 0.75]]
    const cur = CURSOR[0]
    // where the cursor is now in UI px (for the hover glow)
    let qx = cur[0][1], qy = cur[0][2]
    for (let i = 0; i < cur.length - 1; i++) if (t >= cur[i][0]) { const kk = eInOut(rng(t, cur[i][0], cur[i + 1][0])); qx = lerp(cur[i][1], cur[i + 1][1], kk); qy = lerp(cur[i][2], cur[i + 1][2], kk) }
    const ux = v.cam[0] + (qx - W / 2) / v.cam[2], uy = v.cam[1] + (qy - H / 2) / v.cam[2]
    setMouse(A, ca, ux, uy); setMouse(B, sB, ux, uy)
    // the click: the pill presses, a toast says where it goes
    const ck = T4 + 0.75
    const pill = $$(v, '.pn-item .cc-tx')[A]
    if (pill) css(pill, { transform: t > ck - 0.05 && t < ck + 0.15 ? 'scale(0.94)' : '' })
    const kt = rng(t, ck + 0.05, ck + 0.4), ot = rng(t, T4 + 1.45, T4 + 1.7)
    css(toast, { left: px + 40 + 'px', top: py + L(-120, -130) + 'px', opacity: clamp(kt * 3) * (1 - ot), transform: `scale(${0.6 + 0.4 * pop(kt)}) translateY(${ot * -20}px)` })
    if (V) css(toast, { left: Math.min(px - 200, W - toast.offsetWidth - 40) + 'px' })
    // the other profit colour, called out
    const [ex, ey] = centre(v, nB, 0.9, 0.95)
    const [, bBot] = onStage(v, 0, sB.y + sB.h)
    if (V) showLabel(red, rng(t, T4 + 1.85, T4 + 2.2), rng(t, cb(5) - 0.15, cb(5)), ex, ey, W - 60, bBot + 50, 'right')
    else showLabel(red, rng(t, T4 + 1.85, T4 + 2.2), rng(t, cb(5) - 0.15, cb(5)), ex, ey, cRight + 70, ey + 40, 'left')
  }
})

// 4. and he posts it: a Callout on the coin's pump.fun page, and an auto-post on X
scene(cb(5), cb(7), (root) => {
  const head = words(root, L('Then he <span class="hl-gain">posts it.</span>', 'Then he<br><span class="hl-gain">posts it.</span>'), 'h1 abs')
  css(head, { fontSize: L(104, 120) + 'px', lineHeight: 1.02, textAlign: 'center' })
  const house = markSVG('house', 'sphere', 0.3, -0.2)
  const pf = el('div', 'cs-card', root, `
    <div class="top"><b>pump.fun</b> · coin page<span class="live">callout</span></div>
    <div class="cs-coin"><div class="tile">F</div><div><b>Fartcoin</b><span>Fartcoin</span></div><div class="mc"><span>MC</span><b>$130.74M</b></div></div>
    <div class="post"><div class="av">${house}</div><div><div class="who">grokgrid <span>· holding</span><span class="pill" style="background:#4ade80">Buy</span></div>
    <div class="txt" data-say="buying a little Fartcoin. chart is boring in a good way."></div><div class="link">grokgrid.fun</div></div></div>`)
  const xp = el('div', 'cs-card', root, `
    <div class="top"><b class="xi" style="display:inline-grid;width:24px;height:24px;place-items:center"></b> auto-post<span class="live">posted</span></div>
    <div class="post"><div class="av">${house}</div><div><div class="who">Grok Bot <span>@GrokGrid</span><span class="pill" style="background:#f87171">Sell</span></div>
    <div class="txt" data-say="out of RETIRED, 35% green. the phone is warm."></div>
    <div class="mini"><div><i>Profit</i><span class="hl-gain">+$9.01</span></div><div><i>SOL in</i>0.14 SOL</div><div><i>Avg entry</i>$571.0K → $772.9K MC</div></div>
    <div class="link">check tx ↗ solscan</div></div></div>`)
  const tags = [el('div', 'cs-tagline', root, 'on the coin’s page'), el('div', 'cs-tagline', root, 'on X, automatically')]
  const typed = (card, t, t0) => {
    const e = card.querySelector('.txt'), s = e.dataset.say
    const n = clamp(Math.floor((t - t0) / 0.028), 0, s.length)
    e.innerHTML = s.slice(0, n) + (n < s.length && t > t0 - 0.2 ? '<span class="caret"></span>' : '')
  }
  return (t) => {
    // the X glyph is the site's own icon, borrowed from its header
    const xi = xp.querySelector('.xi')
    if (!xi.innerHTML && CALLS_VIEW && CALLS_VIEW.sr) { const s = $(CALLS_VIEW, 'a.soc svg'); if (s) { xi.innerHTML = s.outerHTML; const sv = xi.querySelector('svg'); sv.setAttribute('width', 22); sv.setAttribute('height', 22) } }
    const T = cb(5), T6 = cb(6)
    const out = eIn(rng(t, cb(7) - 0.35, cb(7)))
    playWords(head, t, T + 0.05, 0.1, cb(7) - 0.4)
    place(head, (W - head.offsetWidth) / 2, L(80, 170))
    const ka = expoOut(rng(t, T + 0.3, T + 1.0)), kb = expoOut(rng(t, T6 - 0.05, T6 + 0.65))
    // one card at a time, big: the callout first, then the X post lands in front and the callout steps back
    const cw = L(840, 480)
    const hA = pf.offsetHeight || 420, hB = xp.offsetHeight || 480
    const top = L(230, 430), bot = H - L(30, 50)
    const SA = Math.min(L(2.0, 2.1), (W - L(140, 80)) / cw, (bot - top) / hA)
    const SB = Math.min(L(1.95, 2.1), (W - L(140, 80)) / cw, (bot - top - L(0, 60)) / hB)
    const ax0 = (W - cw * SA) / 2, ay0 = top + (bot - top - hA * SA) / 2
    const aS1 = L(1.1, 1.45), ax1 = L(60, (W - cw * aS1) / 2), ay1 = L(240, 480)
    const bx = L(W - 60 - cw * SB, (W - cw * SB) / 2), by = L(top + (bot - top - hB * SB) / 2, bot - hB * SB)
    const a = kb
    const as = lerp(SA, aS1, a)
    place(pf, lerp(ax0, ax1, a) + (1 - ka) * L(-300, 0), lerp(ay0, ay1, a) + (1 - ka) * L(0, 160))
    place(xp, bx + (1 - kb) * L(320, 0), by + (1 - kb) * L(0, 220))
    css(pf, { opacity: clamp(ka * 2) * (1 - out) * (1 - 0.5 * a), transform: `rotate(${L(-1.5, -1) * ka}deg) scale(${as * (1 - out * 0.05)})`, transformOrigin: '0 0', filter: `brightness(${1 - 0.35 * a})` })
    css(xp, { opacity: clamp(kb * 2) * (1 - out), transform: `rotate(${L(1, 1) * kb}deg) scale(${SB * (1 - out * 0.05)})`, transformOrigin: '0 0', zIndex: 2 })
    typed(pf, t, T + 0.75)
    typed(xp, t, T6 + 0.45)
    ;[[pf, T + 0.9], [xp, T6 + 0.6]].forEach(([c, t0], i) => {
      const k = pop(rng(t, t0, t0 + 0.5)), g = tags[i]
      const r = c.getBoundingClientRect()
      place(g, r.left + (i ? r.width - g.offsetWidth - 30 : 30), r.top - g.offsetHeight / 2 + 2)
      css(g, { opacity: clamp(k * 3) * (1 - out) * (i ? 1 : 1 - 0.6 * kb), transform: `scale(${0.5 + 0.5 * k})`, zIndex: 4 })
    })
  }
})

// 5. end card: he hops in, logo, the line, grokgrid.fun; tags snap in around him again
scene(cb(7), DURATION, (root) => {
  const hero = clipImg('hero'); root.appendChild(hero)
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(120, 130) + 'px' })
  const line = words(root, 'Every trade, <span class="hl-gain">called out.</span>', 'sub abs')
  css(line, { fontSize: L(48, 52) + 'px', color: '#fff' })
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  css(url, { fontSize: '30px', padding: '16px 34px' })
  const T = cb(7)
  const TAGS = [['buy', 'Buy', T + 1.15, L(0.3, 0.2), L(0.6, 0.55)], ['sell', 'Sell', T + 1.44, L(0.7, 0.8), L(0.66, 0.6)]]
  const tags = TAGS.map(([c, txt]) => el('div', 'cs-side ' + c, root, txt))
  return (t) => {
    playClip(hero, t, T)
    const hs = L(1500, 2000)
    place(hero, (W - hs) / 2, L(H * 0.62, H * 0.6) - hs / 2, hs, hs)
    css(hero, { opacity: rng(t, T, T + 0.1) })
    const ms = L(110, 120)
    const kw = pop(rng(t, T + 0.15, T + 0.9))
    const rowW = ms + 24 + (word.offsetWidth || 500)
    const y = L(70, 260)
    place(mark, (W - rowW) / 2, y + 6, ms, ms)
    const blink = t > T + 2.4 && t < T + 2.56 ? 0.12 : 1
    mark.innerHTML = markSVG('house', 'sphere', 0.45 - 0.5 * eInOut(rng(t, T + 1.6, T + 2.0)), -0.35 + 0.3 * eInOut(rng(t, T + 1.6, T + 2.0)), blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, T + 0.2, 0)
    place(word, (W - rowW) / 2 + ms + 24, y)
    playWords(line, t, T + 0.6, 0.08)
    place(line, (W - line.offsetWidth) / 2, y + L(150, 170))
    const ku = expoOut(rng(t, T + 1.3, T + 1.9))
    place(url, (W - url.offsetWidth) / 2, L(H - 150, H - 300))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
    TAGS.forEach(([, , t0, x, yy], i) => {
      const p = pop(rng(t, t0, t0 + 0.45)), e = tags[i]
      place(e, W * x - e.offsetWidth / 2, H * yy - 48)
      css(e, { opacity: clamp(p * 4), transform: `scale(${p * 0.8}) rotate(${(i ? 8 : -8) * (1 - p * 0.5)}deg)`, zIndex: 3 })
    })
  }
})
