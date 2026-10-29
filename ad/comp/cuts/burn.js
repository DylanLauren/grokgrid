// "The fee loop": where creator fees go. $GRID fees split 80% treasury / 20% buy and burn, every bot coin splits
// 80% to its own wallet / 20% buy and burn, so every bot that trades feeds one burn. Then the rules on the real
// Docs page and the "$GRID burned" tile on the real Stats page. 88 bpm: one bar is 2.727 s.
const DURATION = 23.0
const BB = 60 / 88, BR = BB * 4 // beat, bar (the track uses the same grid)
const C1 = BR, C2 = BR + 6 * BB, C3 = 4 * BR, C4 = 4 * BR + 6 * BB, C5 = 7 * BR // 2.73, 6.82, 10.91, 15.0, 19.09

// ---------- local styles ----------
const bnStyle = document.createElement('style')
bnStyle.textContent = `
.bn-coin { position: absolute; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 35% 30%, #fff, #d9d9d9 55%, #9a9a9a); box-shadow: 0 0 0 1.5px rgba(0,0,0,.35) inset, 0 4px 12px rgba(0,0,0,.5); }
.bn-coin.o { background: radial-gradient(circle at 35% 30%, #ffd2a8, #ff8a2a 50%, #e25500); box-shadow: 0 0 0 1.5px rgba(0,0,0,.25) inset, 0 0 18px rgba(255,106,0,.85); }
.bn-glow { position: absolute; border-radius: 50%; pointer-events: none; background: radial-gradient(closest-side, rgba(255,106,0,.55), rgba(255,106,0,.18) 55%, rgba(255,106,0,0)); }
.bn-ember { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; background: #ffb066; box-shadow: 0 0 10px #ff6a00; pointer-events: none; }
.bn-lab { position: absolute; font: 500 30px 'Geist'; color: rgba(255,255,255,.72); white-space: nowrap; letter-spacing: -0.02em; }
.bn-lab .mono { font-size: 22px; color: rgba(255,255,255,.45); display: block; margin-bottom: 4px; letter-spacing: .04em; text-transform: uppercase; }
.bn-mini { position: absolute; height: 10px; border-radius: 999px; overflow: hidden; display: flex; gap: 2px; background: rgba(255,255,255,.06); }
.bn-mini i { display: block; height: 100%; border-radius: 999px; background: #fff; }
.bn-mini i + i { background: #ff6a00; }
.bn-scrim { position: absolute; left: 0; right: 0; pointer-events: none; }
.bn-ring { position: absolute; border-radius: 22px; border: 2px solid #ff6a00; box-shadow: 0 0 0 6px rgba(255,106,0,.16), 0 0 60px rgba(255,106,0,.45); pointer-events: none; }
.bn-tagc { position: absolute; display: flex; align-items: center; gap: 12px; padding: 12px 24px 12px 14px; border-radius: 999px; background: rgba(20,20,20,.94);
  border: 1px solid rgba(255,106,0,.55); font: 500 30px 'Geist'; color: #fff; white-space: nowrap; box-shadow: 0 14px 40px rgba(0,0,0,.6); }
`
bnStyle.textContent += '.bn-tagc, .bn-lab, .bn-mini, .bn-ring, .bn-scrim, #stage .scene .abs.mono { pointer-events: none; }'
document.head.appendChild(bnStyle)

// ---------- the flame: layered tongues that flicker, a glow, embers ----------
function tongue(w, h, sway, lean) {
  return `M${-w} 0 C${-w * 1.35} ${-h * 0.32} ${-w * 0.5 + lean} ${-h * 0.62} ${sway} ${-h} C${w * 0.55 + lean} ${-h * 0.6} ${w * 1.35} ${-h * 0.34} ${w} 0 C${w * 0.95} ${w * 0.9} ${-w * 0.95} ${w * 0.9} ${-w} 0Z`
}
function flameSVG(t, seed = 0, heat = 1) {
  const s = (f, p) => Math.sin(t * f + seed * 1.7 + p)
  const h0 = 112 + 10 * s(13, 0) + 6 * s(21, 1)
  const out = [
    [tongue(18, h0 * 0.62, -20 + 6 * s(17, 2), -8), '#ff6a00', 0.9],
    [tongue(18, h0 * 0.68, 22 + 6 * s(15, 3), 8), '#ff6a00', 0.9],
    [tongue(34, h0, 6 * s(11, 4) + 4 * s(29, 5), 3 * s(9, 6)), '#ff6a00', 1],
    [tongue(25, h0 * 0.74, 5 * s(14, 7), 2 * s(19, 8)), '#ff9a00', 1],
    [tongue(15, h0 * 0.46 * (0.8 + 0.2 * heat), 4 * s(23, 9), 0), '#ffd29a', 1],
    [tongue(7, h0 * 0.22, 2 * s(31, 10), 0), '#fff4e6', 0.95],
  ]
  return `<svg viewBox="-60 -140 120 160" width="100%" height="100%" style="overflow:visible">${out.map(([d, c, o]) => `<path d="${d}" fill="${c}" opacity="${o}"/>`).join('')}</svg>`
}
function makeFlame(parent, nEmbers = 10) {
  const glow = el('div', 'bn-glow', parent)
  const f = el('div', 'abs', parent)
  f.style.pointerEvents = 'none'
  const embers = Array.from({ length: nEmbers }, () => el('div', 'bn-ember', parent))
  return { glow, f, embers }
}
// x, base y in px, sc = px per flame unit (the flame is ~120 units tall), a = opacity
function drawFlame(fl, t, x, by, sc, a, seed = 0, heat = 1) {
  const w = 120 * sc, h = 160 * sc
  fl.f.innerHTML = flameSVG(t, seed, heat)
  place(fl.f, x - w / 2, by - h * (140 / 160), w, h)
  css(fl.f, { opacity: a, filter: `drop-shadow(0 0 ${18 * sc}px rgba(255,106,0,.7))` })
  const g = 320 * sc * (1 + 0.05 * Math.sin(t * 9 + seed))
  place(fl.glow, x - g / 2, by - 70 * sc - g / 2, g, g)
  css(fl.glow, { opacity: a * (0.75 + 0.25 * heat) })
  fl.embers.forEach((e, i) => {
    const per = 0.9 + (i % 3) * 0.2, ph = ((t + i * 0.37 + seed) % per) / per
    const ex = x + Math.sin(i * 2.3 + seed) * 26 * sc + Math.sin(t * 3 + i) * 10 * sc * ph
    const ey = by - 60 * sc - ph * 150 * sc
    place(e, ex, ey)
    css(e, { opacity: a * Math.sin(ph * Math.PI) * 0.9, transform: `scale(${(1 - ph) * Math.max(0.6, sc * 1.4)})` })
  })
}
const qb = (a, c, b, k) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * c + k * k * b

// =====================================================================
// 1. hook: his face, "Every trade" ... the flame erupts, "feeds the burn."
scene(0, C1 + 0.05, (root) => {
  const face = clipImg('face'); root.appendChild(face)
  const fl = makeFlame(root, 14)
  const a = words(root, 'Every trade', 'h1 abs')
  css(a, { fontSize: L(150, 150) + 'px' })
  const b = words(root, 'feeds the <span class="hl-orange">burn.</span>', 'h1 abs')
  css(b, { fontSize: L(150, 150) + 'px' })
  const flash = el('div', 'abs', root)
  css(flash, { inset: 0, background: 'radial-gradient(60% 50% at 50% 80%, rgba(255,140,40,.55), rgba(255,106,0,0))', pointerEvents: 'none' })
  return (t) => {
    playClip(face, t, 0)
    const fs = L(900, 1100)
    const push = eInOut(rng(t, 1.2, 1.7))
    const fx = L(W * 0.5 - fs / 2 + push * -400, W / 2 - fs / 2 + push * 0.125 * fs), fy = L(H * 0.5 - fs / 2 + 270 - push * 170, H * 0.56 - fs / 2 - push * (0.08 * H - 0.125 * fs))
    place(face, fx, fy, fs * (1 - push * 0.25), fs * (1 - push * 0.25))
    css(face, { opacity: rng(t, 0, 0.25) * (1 - eIn(rng(t, 2.5, 2.75))) })
    playWords(a, t, 0.12, 0.16, 2.45)
    playWords(b, t, 1.38, 0.13, 2.5)
    if (V) { place(a, (W - a.offsetWidth) / 2, 210); place(b, (W - b.offsetWidth) / 2, 380) }
    else { place(a, W * 0.5 - a.offsetWidth / 2 + push * 330, 60 + push * 80); place(b, W * 0.5 - a.offsetWidth / 2 + push * 330, 300) }
    // the flame erupts on beat 3
    const k = pop(rng(t, 1.36, 1.9))
    const out = eIn(rng(t, 2.45, 2.75))
    const fxp = L(W * 0.62, W * 0.5), fby = L(H + 40, H + 60)
    drawFlame(fl, t, fxp + L(110, 0), fby, L(5.2, 4.6) * k * (1 + 0.04 * Math.sin(t * 7)), clamp(k * 2) * (1 - out), 1, 1)
    css(flash, { opacity: (1 - rng(t, 1.36, 2.2)) * rng(t, 1.3, 1.38) })
  }
})

// 2. $GRID: the fees stream into the 80/20 bar; 80% to the treasury (his trades), 20% buys and burns $GRID
scene(C1, C2 + 0.05, (root) => {
  const T = C1
  const head = words(root, L('Every <span class="hl-orange">$GRID</span> fee, split.', 'Every <span class="hl-orange">$GRID</span><br>fee, split.'), 'h1 abs')
  css(head, { fontSize: L(96, 112) + 'px', textAlign: 'center' })
  const pill = el('div', 'coin', root, `<div style="width:68px;height:68px">${markSVG('house', 'sphere')}</div>$GRID <span class="mono dim" style="font-size:26px">creator fees</span>`)
  css(pill, { fontSize: '36px', padding: '14px 32px 14px 14px' })
  const bot = clipImg('phone'); root.appendChild(bot)
  const fl = makeFlame(root, 8)
  const coins = Array.from({ length: 34 }, (_, i) => el('div', 'bn-coin' + (i % 5 === 4 ? ' o' : ''), root))
  const sp = el('div', 'split', root)
  const bar = el('div', 'bar', sp)
  const a = el('div', 'seg a', bar, '<span class="pa">80%</span>')
  const b = el('div', 'seg b', bar, '<span class="pb">20%</span>')
  const la = el('div', 'bn-lab', root, '<span class="mono">80% · treasury</span>Grok Bot’s trading wallet')
  const lb = el('div', 'bn-lab', root, `<span class="mono" style="color:#ff6a00">20% · burn</span>${L('buys + burns $GRID', 'burns $GRID')}`)
  return (t) => {
    const out = eIn(rng(t, C2 - 0.3, C2 + 0.05))
    playWords(head, t, T + 0.05, 0.1, C2 - 0.35)
    place(head, (W - head.offsetWidth) / 2, L(70, 200))
    const kc = pop(rng(t, T + 0.25, T + 0.9))
    const py = L(215, 500)
    css(pill, { left: (W - pill.offsetWidth) / 2 + 'px', top: py + 'px', opacity: clamp(kc * 3) * (1 - out), transform: `scale(${kc})`, zIndex: 3 })
    const bw = L(1400, 960), bx = (W - bw) / 2, by = L(370, 690)
    place(sp, bx, by, bw)
    css(sp, { opacity: rng(t, T + 0.55, T + 0.75) * (1 - out), zIndex: 2 })
    css(bar, { width: bw + 'px' })
    const fa = expoOut(rng(t, T + 0.7, T + 1.5)), fb = expoOut(rng(t, T + 1.15, T + 1.9))
    css(a, { width: bw * 0.8 * fa + 'px' }); css(b, { width: bw * 0.2 * fb + 'px' })
    a.querySelector('.pa').textContent = Math.round(80 * fa) + '%'
    b.querySelector('.pb').textContent = Math.round(20 * fb) + '%'
    // destinations: him trading under the 80, the flame under the 20
    const ax = bx + bw * 0.4, bxx = bx + bw * 0.9
    const bs = L(1000, 1150), bty = L(H * 0.72, 1380)
    playClip(bot, t, T, { loop: true })
    const kb = expoOut(rng(t, T + 1.2, T + 1.9))
    place(bot, ax - bs / 2 + L(-60, 60), bty - bs / 2 + (1 - kb) * 80, bs, bs)
    css(bot, { opacity: kb * (1 - out) })
    // the flame grows with every orange coin that lands
    const land = (i) => T + 0.9 + i * 0.16 + 0.75
    let n = 0; coins.forEach((c, i) => { if (i % 5 === 4 && t > land(i)) n++ })
    const kf = pop(rng(t, T + 1.5, T + 2.1))
    const fby = L(H - 110, 1620)
    drawFlame(fl, t, bxx, fby, L(1.9, 2.6) * kf * (1 + n * 0.09), clamp(kf * 3) * (1 - out), 2, clamp(n / 5))
    // coins: pill -> bar (white or orange segment) -> him or the flame
    coins.forEach((c, i) => {
      const t0 = T + 0.9 + i * 0.16, k = (t - t0) / 0.75
      if (k < 0 || k > 1) { css(c, { opacity: 0 }); return }
      const burn = i % 5 === 4
      const jx = Math.sin(i * 2.7) * L(40, 30)
      const sx = W / 2 + jx * 0.3, sy = py + 40
      const mx = burn ? bxx + jx * 0.3 : ax + jx * 4, my = by + 48
      const ex = burn ? bxx + jx * 0.2 : ax + L(-60, 60) + jx, ey = burn ? fby - 60 * L(1.9, 2.6) : bty - L(40, 50)
      let x, y
      if (k < 0.45) { const q = eIn(k / 0.45, 2); x = lerp(sx, mx, q); y = lerp(sy, my, q) }
      else { const q = eOut((k - 0.45) / 0.55, 2); x = lerp(mx, ex, q); y = lerp(my, ey, q) }
      place(c, x, y)
      css(c, { opacity: clamp(k * 8) * clamp((1 - k) * 6) * (1 - out), transform: `scale(${burn ? 1.1 : 0.9}) rotateY(${t * 400 + i * 40}deg)`, zIndex: 1 })
    })
    const lt = by + L(120, 120)
    css(la, { left: bx + 6 + 'px', top: lt + 'px', opacity: rng(t, T + 1.4, T + 1.7) * (1 - out), transform: `translateY(${(1 - eOut(rng(t, T + 1.4, T + 1.8))) * 14}px)`, zIndex: 3 })
    css(lb, { left: bx + bw - lb.offsetWidth - 6 + 'px', top: lt + 'px', textAlign: 'right', opacity: rng(t, T + 1.7, T + 2.0) * (1 - out), transform: `translateY(${(1 - eOut(rng(t, T + 1.7, T + 2.1))) * 14}px)`, zIndex: 3 })
  }
})

// 3. the grid: every bot coin keeps 80% for its bot and sends 20% to the one $GRID burn
scene(C2, C3 + 0.05, (root) => {
  const T = C2
  const head = words(root, L('Every bot feeds <span class="hl-orange">one burn.</span>', 'Every bot feeds<br><span class="hl-orange">one burn.</span>'), 'h1 abs')
  css(head, { fontSize: L(96, 112) + 'px', textAlign: 'center' })
  const sub = words(root, L('80% trades for that bot. 20% buys and burns <b style="color:#ff6a00">$GRID</b>.', '80% trades for that bot.<br>20% buys and burns <b style="color:#ff6a00">$GRID</b>.'), 'sub abs')
  css(sub, { fontSize: L(38, 40) + 'px', textAlign: 'center', lineHeight: 1.3 })
  const fl = makeFlame(root, 18)
  const blab = el('div', 'abs mono', root, '$GRID burn wallet')
  css(blab, { fontSize: '20px', color: 'rgba(255,255,255,.55)', letterSpacing: '.04em', textTransform: 'uppercase' })
  // the outer crowd (many more bots) first, so the inner family sits on top
  const NO = L(26, 22)
  const outer = Array.from({ length: NO }, (_, i) => {
    const [c, s] = FAMILY[(i * 4 + 1) % FAMILY.length]
    return { m: el('div', 'mark', root, markSVG(c, s, Math.sin(i) * 0.5, -0.2)), sp: el('div', 'bn-coin o', root) }
  })
  const bots = [['house', 'sphere'], ...FAMILY.slice(1), FAMILY[0]].map(([c, s], i) => {
    const m = el('div', 'mark', root, '')
    const mini = el('div', 'bn-mini', root, '<i></i><i></i>')
    const cs = Array.from({ length: 5 }, (_, k) => el('div', 'bn-coin' + (k === 4 ? ' o' : ''), root))
    return { m, mini, cs, c, s }
  })
  return (t) => {
    const out = eIn(rng(t, C3 - 0.3, C3 + 0.05))
    playWords(head, t, T + 0.05, 0.1, C3 - 0.35)
    place(head, (W - head.offsetWidth) / 2, L(56, 170))
    playWords(sub, t, T + 1.6, 0.05, C3 - 0.35)
    place(sub, (W - sub.offsetWidth) / 2, L(H - 108, H - 200))
    css(head, { zIndex: 6 }); css(sub, { zIndex: 6 })
    const cx = W / 2, cy = L(590, 1040)
    const rx = L(720, 400), ry = L(250, 420)
    // flame in the middle grows as the burns arrive
    const kf = pop(rng(t, T + 0.15, T + 0.8))
    const grow = 1 + 0.5 * eOut(rng(t, T + 0.8, C3 - 0.3))
    const fby = cy + L(130, 150)
    drawFlame(fl, t, cx, fby, L(2.0, 2.3) * kf * grow, clamp(kf * 3) * (1 - out), 3, 1)
    place(blab, cx - blab.offsetWidth / 2, fby + L(26, 34))
    css(blab, { opacity: rng(t, T + 0.6, T + 0.9) * (1 - out) })
    const fTop = [cx, fby - 70 * L(2.0, 2.3) * grow]
    // inner ring: ten bots, each with its own 80/20 bar; white coins hop back into the bot, the orange one flies to the flame
    const NB = bots.length
    bots.forEach((o, i) => {
      const ang = Math.PI * (0.5 + (i + 0.5) / NB * 2) // start from the bottom, go round
      const sz = L(118, 128)
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry
      const kp = pop(rng(t, T + 0.25 + i * 0.07, T + 0.9 + i * 0.07))
      const lx = clamp((cx - x) / 300, -1, 1) * 0.7, ly = clamp((fTop[1] - y) / 300, -1, 1) * 0.5
      const blink = ((t + i * 0.7) % 3.1) < 0.12 ? 0.12 : 1
      o.m.innerHTML = markSVG(o.c, o.s, lx, ly, blink)
      const bob = Math.sin(t * 5 + i) * 4
      place(o.m, x - sz / 2, y - sz / 2 + bob, sz, sz)
      css(o.m, { opacity: clamp(kp * 3) * (1 - out), transform: `scale(${kp})`, zIndex: 3 })
      const mw = sz * 0.9
      place(o.mini, x - mw / 2, y + sz / 2 + 10, mw)
      const km = expoOut(rng(t, T + 0.8 + i * 0.05, T + 1.4 + i * 0.05))
      o.mini.children[0].style.width = 80 * km + '%'; o.mini.children[1].style.width = 20 * km + '%'
      css(o.mini, { opacity: clamp(kp * 2) * (1 - out) })
      o.cs.forEach((c, k) => {
        const burn = k === 4
        const per = 1.25
        const base = T + 1.0 + i * 0.09 + k * 0.17
        let ph = (t - base) / (burn ? 0.85 : 0.55)
        // each coin repeats once a cycle
        if (t > base) { const cyc = Math.floor((t - base) / per); ph = (t - base - cyc * per) / (burn ? 0.85 : 0.55) }
        if (ph < 0 || ph > 1) { css(c, { opacity: 0 }); return }
        const sx = x, sy = y - sz * 0.45
        let px, py
        if (burn) {
          const ctlx = (x + fTop[0]) / 2, ctly = Math.min(y, fTop[1]) - L(160, 200)
          const q = eInOut(ph)
          px = qb(sx, ctlx, fTop[0], q); py = qb(sy, ctly, fTop[1] + 30, q)
        } else {
          const dir = (k % 2 ? 1 : -1) * (0.6 + k * 0.15)
          px = sx + Math.sin(ph * Math.PI) * dir * 34; py = sy - Math.sin(ph * Math.PI) * (70 + k * 10) + ph * sz * 0.45
        }
        place(c, px, py)
        css(c, { opacity: Math.sin(clamp(ph) * Math.PI) * 1.4 * (1 - out) * clamp(kp), transform: `scale(${burn ? 1 : 0.72})`, zIndex: burn ? 4 : 2 })
      })
    })
    // then many more bots fill in behind, all sparking into the same flame
    outer.forEach((o, i) => {
      const ang = Math.PI * 2 * (i / NO) + 0.2
      const r1 = L(1.32, 1.22), sz = L(64, 64)
      const x = cx + Math.cos(ang) * rx * r1 * L(1.08, 1.05), y = cy + Math.sin(ang) * ry * r1 * L(1.22, 1.2)
      const kp = pop(rng(t, T + 2.0 + (i % 9) * 0.05, T + 2.6 + (i % 9) * 0.05))
      place(o.m, x - sz / 2, y - sz / 2 + Math.sin(t * 4 + i) * 3, sz, sz)
      css(o.m, { opacity: clamp(kp * 3) * 0.55 * (1 - out), transform: `scale(${kp})`, zIndex: 1 })
      const base = T + 2.4 + (i % 7) * 0.11, per = 0.8
      let ph = -1
      if (t > base) ph = ((t - base) % per) / 0.75
      if (ph < 0 || ph > 1) { css(o.sp, { opacity: 0 }); return }
      const q = eIn(ph, 2)
      place(o.sp, lerp(x, fTop[0], q), lerp(y, fTop[1] + 30, q) - Math.sin(ph * Math.PI) * 60)
      css(o.sp, { opacity: Math.sin(ph * Math.PI) * (1 - out) * 0.9, transform: 'scale(.6)', zIndex: 1 })
    })
  }
})

// 4. the rules: the real Docs page, "Where the money goes", both 80/20 bars fill in
scene(C3, C4 + 0.05, (root) => {
  const T = C3
  const v = uiView(root, V ? 'm-docs' : 'docs')
  const scrim = el('div', 'bn-scrim', root)
  const head = words(root, L('It’s in <span class="hl-orange">the docs.</span>', 'It’s in<br><span class="hl-orange">the docs.</span>'), 'h1 abs')
  css(head, { fontSize: L(88, 110) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  const fl = makeFlame(root, 6)
  let styled = false
  return (t) => {
    if (!v.sr) return
    if (!styled) {
      styled = true
      const st = document.createElement('style')
      st.textContent = `.dc-sec .dc-w, .dc-sec > :not(h2), .dc-toc a, .mf-seg { transition: none !important; } .dc-sec .dc-w, .dc-sec > :not(h2) { opacity: 1; translate: 0 0; } .dc-toc > * { animation: none !important; }`
      v.sr.appendChild(st)
    }
    const title = box(v, 'title', '.pg-title'), toc = box(v, 'toc', 'a[href="#docs/money"]'), mf = box(v, 'mf', '.mf')
    const sec = box(v, 'sec', '#dc-money'), burnC = box(v, 'burnc', '.mf-to .burn', 0)
    const out = eIn(rng(t, C4 - 0.3, C4 + 0.05)), k = expoOut(rng(t, T, T + 0.6))
    const mx = mf.x + mf.w * 0.5, my = mf.y + mf.h * 0.5
    if (V) camera(v, t, [[T, 215, title.y + 300, 2.1], [T + 0.9, 215, toc.y - 10, 2.2], [T + 1.5, 215, toc.y, 2.25], [T + 2.1, mx, my + 10, 2.25], [T + 3.2, mx + 40, my + 20, 2.45], [C4, mx + 60, my + 25, 2.5]])
    else camera(v, t, [[T, 800, toc.y + 40, 1.42], [T + 0.9, 800, toc.y + 60, 1.5], [T + 1.5, 820, toc.y + 60, 1.52], [T + 2.1, mx - 80, my - 30, 1.9], [T + 3.2, mx - 40, my - 20, 2.0], [C4, mx - 20, my - 14, 2.06]])
    pageIn(v, t, T + 0.05)
    css(v.wrap, { opacity: clamp(k * 2) * (1 - out) })
    if (V) css(v.wrap, { maskImage: 'linear-gradient(transparent 340px, #000 480px)', webkitMaskImage: 'linear-gradient(transparent 340px, #000 480px)' })
    else css(v.wrap, { maskImage: 'linear-gradient(transparent 120px, #000 300px)', webkitMaskImage: 'linear-gradient(transparent 120px, #000 300px)' })
    cascade($$(v, '.dc-toc > *'), t, T + 0.2, 0.04, 16)
    // the click on "Where the money goes" moves the highlight
    const clicked = t >= T + 1.35
    $$(v, '.dc-toc a').forEach((a) => a.classList.toggle('on', clicked ? a.getAttribute('href') === '#docs/money' : a.getAttribute('href') === '#docs/what'))
    // section words rise, then both bars fill and the numbers count
    $$(v, '#dc-money .dc-w').forEach((w, i) => { const q = expoOut(rng(t, T + 1.7 + i * 0.06, T + 2.3 + i * 0.06)); w.style.opacity = clamp(q * 1.5); w.style.translate = `0 ${(1 - q) * 0.4}em` })
    $$(v, '.mf-row').forEach((row, r) => {
      const t0 = T + 2.1 + r * 0.45
      const qa = expoOut(rng(t, t0, t0 + 0.8)), qb2 = expoOut(rng(t, t0 + 0.3, t0 + 1.0))
      const seg = row.querySelectorAll('.mf-seg'), bs = row.querySelectorAll('.mf-to b')
      if (seg[0]) seg[0].style.width = 80 * qa + '%'
      if (seg[1]) seg[1].style.width = 20 * qb2 + '%'
      if (bs[0]) bs[0].textContent = Math.round(80 * qa) + '%'
      if (bs[1]) bs[1].textContent = Math.round(20 * qb2) + '%'
    })
    void sec
    // a small flame lights beside the first burn column
    const [fx, fy] = centre(v, burnC, 1, 0.3)
    const kf = pop(rng(t, T + 2.6, T + 3.1))
    drawFlame(fl, t, fx + L(30, 6), fy + 18, L(0.42, 0.5) * kf, clamp(kf * 3) * (1 - out), 4, 1)
    playWords(head, t, T + 0.15, 0.1, C4 - 0.4)
    if (V) place(head, (W - head.offsetWidth) / 2, 120)
    else place(head, 90, 64)
    css(scrim, { top: 0, height: L(260, 0) + 'px', background: 'linear-gradient(rgba(10,10,10,.9), rgba(10,10,10,0))', opacity: 1 - out })
    const [tx, ty] = centre(v, toc, 0.4, 0.5)
    CURSOR = [[[T + 0.5, tx + 260, ty + 220], [T + 1.25, tx, ty], [T + 1.6, tx + 4, ty + 3], [T + 2.6, tx + 400, ty + 520]], [T + 1.35]]
  }
})

// 5. the count: the real Stats page, the "$GRID burned" tile lights up
scene(C4, C5 + 0.05, (root) => {
  const T = C4
  const v = uiView(root, V ? 'm-stats' : 'stats')
  const ring = el('div', 'bn-ring', root)
  const fl = makeFlame(root, 6)
  const head = words(root, L('Every burn, <span class="hl-orange">counted.</span>', 'Every burn,<br><span class="hl-orange">counted.</span>'), 'h1 abs')
  css(head, { fontSize: L(96, 112) + 'px', lineHeight: 1.04, textAlign: 'center' })
  const tag = el('div', 'bn-tagc', root, `<div style="width:40px;height:40px">${markSVG('house', 'sphere')}</div>read straight off the chain`)
  return (t) => {
    if (!v.sr) return
    const tiles = $$(v, '.st-tile')
    const bi = tiles.findIndex((e) => /burned/.test(e.textContent))
    const t0b = box(v, 'tile0', '.st-tile', 0), bt = box(v, 'burn', '.st-tile', Math.max(0, bi))
    const out = eIn(rng(t, C5 - 0.3, C5 + 0.05)), k = expoOut(rng(t, T, T + 0.6))
    const bx = bt.x + bt.w * 0.5, by = bt.y + bt.h * 0.5
    if (V) camera(v, t, [[T, 215, t0b.y + 120, 2.0], [T + 1.2, 215, by - 20, 2.15], [T + 2.4, bx, by, 2.9], [C5, bx, by + 4, 3.0]])
    else camera(v, t, [[T, 800, t0b.y + 40, 1.45], [T + 1.2, 820, t0b.y + 50, 1.5], [T + 2.4, bx - 40, by + 10, 2.6], [C5, bx - 34, by + 12, 2.72]])
    css(v.wrap, { opacity: clamp(k * 2) * (1 - out) })
    if (V) css(v.wrap, { maskImage: 'linear-gradient(transparent 330px, #000 470px)', webkitMaskImage: 'linear-gradient(transparent 330px, #000 470px)' })
    else css(v.wrap, { maskImage: 'linear-gradient(transparent 170px, #000 330px)', webkitMaskImage: 'linear-gradient(transparent 170px, #000 330px)' })
    cascade(tiles, t, T + 0.15, 0.08, 40)
    // the burned tile lights up: an orange ring, its label warms, a flame beside the count
    const kr = expoOut(rng(t, T + 1.9, T + 2.5))
    const [x0, y0] = onStage(v, bt.x, bt.y), sc = v.cam[2]
    place(ring, x0 - 6, y0 - 6, bt.w * sc + 12, bt.h * sc + 12)
    css(ring, { opacity: kr * (1 - out), transform: `scale(${1.06 - 0.06 * kr})`, borderRadius: 18 * sc + 6 + 'px' })
    const lab = tiles[bi] && tiles[bi].querySelector('.st-k')
    if (lab) lab.style.color = kr > 0.5 ? '#ff6a00' : ''
    const num = tiles[bi] && tiles[bi].querySelector('b')
    const [nx, ny] = num ? (() => { const r = num.getBoundingClientRect(), s = stage.getBoundingClientRect(); return [r.right - s.left, r.bottom - s.top] })() : [0, 0]
    const kf = pop(rng(t, T + 2.2, T + 2.8))
    drawFlame(fl, t, nx + 36 * sc / 2.7 + L(20, 20), ny - 4, (sc / 2.7) * 0.55 * kf, clamp(kf * 3) * (1 - out), 5, 1)
    playWords(head, t, T + 0.1, 0.1, C5 - 0.4)
    if (V) place(head, (W - head.offsetWidth) / 2, 110)
    else place(head, (W - head.offsetWidth) / 2, 60)
    const kt = pop(rng(t, T + 2.6, T + 3.2))
    const [tx, ty] = onStage(v, bt.x + bt.w, bt.y + bt.h)
    place(tag, V ? (W - tag.offsetWidth) / 2 : Math.min(W - tag.offsetWidth - 60, tx - tag.offsetWidth * 0.6), V ? Math.min(H - 220, ty + 40) : Math.min(H - 110, ty + 34))
    css(tag, { opacity: clamp(kt * 3) * (1 - out), transform: `scale(${0.6 + 0.4 * kt})` })
    const [cx, cy] = onStage(v, bt.x + bt.w * 0.55, bt.y + bt.h * 0.35)
    CURSOR = [[[T + 1.0, cx + 300, cy + 360], [T + 2.0, cx, cy], [T + 3.4, cx + 8, cy + 6]], []]
  }
})

// 6. end card: the family, logo, the line, the URL
scene(C5, DURATION, (root) => {
  const T = C5
  const lu = clipImg(V ? 'lineup_v' : 'lineup'); root.appendChild(lu)
  const lw = L(2000, 1380), lh = V ? lw : lw * 900 / 1600
  const fl = makeFlame(root, 12)
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(140, 140) + 'px' })
  const line = words(root, 'Every bot feeds the <span class="hl-orange">burn.</span>', 'sub abs')
  css(line, { fontSize: L(48, 50) + 'px', color: 'rgba(255,255,255,.8)' })
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  const tick = el('div', 'abs mono dim', root, '$GRID · 80 / 20 · buy and burn')
  css(tick, { fontSize: '22px' })
  return (t) => {
    playClip(lu, t, T + 0.05)
    place(lu, (W - lw) / 2, L(-160, H * 0.53 - 0.55 * lh), lw, lh)
    css(lu, { opacity: rng(t, T, T + 0.15) })
    // a low flame warms the family from below
    const kf = expoOut(rng(t, T + 0.2, T + 1.2))
    drawFlame(fl, t, W / 2, L(H + 120, H + 140), L(3.4, 4.0) * kf, 0.5 * kf, 6, 0.6)
    const ms = 120
    const kw = pop(rng(t, T + 1.0, T + 1.8))
    const rowW = ms + 26 + (word.offsetWidth || 500)
    const y = L(56, 300)
    place(mark, (W - rowW) / 2, y + 8, ms, ms)
    const blink = t > T + 2.9 && t < T + 3.05 ? 0.12 : 1
    mark.innerHTML = markSVG('house', 'sphere', 0.45 - 0.5 * eInOut(rng(t, T + 2.0, T + 2.4)), -0.35 + 0.3 * eInOut(rng(t, T + 2.0, T + 2.4)), blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, T + 1.1, 0)
    place(word, (W - rowW) / 2 + ms + 26, y)
    playWords(line, t, T + 1.6, 0.08)
    place(line, (W - line.offsetWidth) / 2, L(H - 300, H - 440))
    const ku = expoOut(rng(t, T + 2.1, T + 2.8))
    place(url, (W - url.offsetWidth) / 2, L(H - 200, H - 330))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
    place(tick, (W - tick.offsetWidth) / 2, L(H - 90, H - 230))
    css(tick, { opacity: rng(t, T + 2.5, T + 3.0) })
  }
})
