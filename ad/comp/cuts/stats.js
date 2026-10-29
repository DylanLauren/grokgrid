// Feature video: "His numbers, on chain." The real Stats page, redrawn from the site's own DOM and driven piece by piece.
// 92 bpm: one bar is 2.609 s, and every scene cut lands on a bar line (tracks/stats.js).
const DURATION = 21
const SB = 60 / 92, BR = SB * 4 // beat and bar, in seconds
const B1 = BR, B3 = 3 * BR, B4 = 4 * BR, B5 = 5 * BR, B6 = 6 * BR // 2.61 7.83 10.43 13.04 15.65

// small helpers for this cut
const stText = (e, s) => { if (e && e.textContent !== s) e.textContent = s }
// the cursor's position at t on a CURSOR path (same easing as core.js runCursor)
function stCur(path, t) {
  let x = path[0][1], y = path[0][2]
  for (let i = 0; i < path.length - 1; i++) {
    const [ta, xa, ya] = path[i], [tb, xb, yb] = path[i + 1]
    if (t >= ta) { const k = eInOut(rng(t, ta, tb)); x = lerp(xa, xb, k); y = lerp(ya, yb, k) }
  }
  return [x, y]
}
// a stage point back to UI pixels under the current camera
const stToUI = (v, x, y) => [v.cam[0] + (x - W / 2) / v.cam[2], v.cam[1] + (y - H / 2) / v.cam[2]]
// the site's card spotlight follows the mouse through --mx/--my; drive it from the drawn cursor
function stGlow(v, cards, sx, sy) {
  const [ux, uy] = stToUI(v, sx, sy)
  cards.forEach(([e, b]) => {
    if (!e) return
    if (ux >= b.x && ux <= b.x + b.w && uy >= b.y && uy <= b.y + b.h) { e.style.setProperty('--mx', ux - b.x + 'px'); e.style.setProperty('--my', uy - b.y + 'px') }
  })
}
// a fixed band at the top where the headline sits; the UI fades in under it
function stMask(v, a, b) {
  const g = `linear-gradient(transparent ${a}px, #000 ${b}px)`
  css(v.wrap, { maskImage: g, webkitMaskImage: g })
}

// 1. hook: the wallet number spins up next to his face, "His numbers, on chain."
scene(0, B1 + 0.02, (root) => {
  const face = clipImg('face'); root.appendChild(face)
  const num = el('div', 'abs h1', root, '<span class="n">0.000</span><small class="mono">SOL</small>')
  css(num, { fontSize: L(250, 230) + 'px', fontWeight: 500, letterSpacing: '-0.05em' })
  const sm = num.querySelector('small')
  css(sm, { fontSize: '0.24em', letterSpacing: '0', color: 'rgba(255,255,255,.5)', marginLeft: '14px', fontWeight: 500 })
  const n = num.querySelector('.n')
  const k1 = el('div', 'abs mono', root, 'WALLET')
  css(k1, { fontSize: L(24, 26) + 'px', letterSpacing: '0.16em', color: 'rgba(255,255,255,.5)' })
  const head = words(root, 'His numbers,<br><span class="hl-gain">on chain.</span>', 'h1 abs')
  css(head, { fontSize: L(118, 124) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  return (t) => {
    const out = eIn(rng(t, B1 - 0.28, B1))
    const fs = L(1150, 1000)
    const kf = backOut(rng(t, 0.0, 0.5), 1.2)
    const [fx, fy] = L([1410, 560], [540, 1390])
    place(face, fx - fs / 2, fy - fs / 2 + (1 - kf) * 120, fs, fs)
    playClip(face, t, 0.0)
    css(face, { opacity: clamp(kf * 2) * (1 - out), transform: `scale(${(0.85 + 0.15 * kf) * (1 + out * 0.15)})` })
    // the number counts up like a slot, then settles
    const kc = eOut(rng(t, 0.15, 1.35), 4)
    stText(n, fmt(1.762 * kc, 3))
    const kn = pop(rng(t, 0.08, 0.7))
    const nw = num.offsetWidth
    const nx = L(110, (W - nw) / 2), ny = L(250, 270)
    place(num, nx, ny)
    css(num, { opacity: clamp(kn * 3) * (1 - out), transform: `scale(${0.7 + 0.3 * kn}) translateY(${-out * 40}px)`, transformOrigin: L('0% 50%', '50% 50%'), filter: `blur(${(1 - clamp(kn * 2)) * 8}px)` })
    place(k1, L(nx + 10, (W - k1.offsetWidth) / 2), ny - L(34, 40))
    css(k1, { opacity: rng(t, 0.2, 0.5) * (1 - out) })
    playWords(head, t, 1.2, 0.13, B1 - 0.32)
    place(head, L(106, (W - head.offsetWidth) / 2), L(560, 600))
  }
})

// 2. the wallet: big number counts up, pills pop, the 6h chart draws itself, then the cursor scrubs it
scene(B1, B3 + 0.02, (root) => {
  const v = uiView(root, V ? 'm-stats' : 'stats')
  const head = words(root, L('His wallet,<br><span class="dim">on chain.</span>', 'His wallet,<br><span class="dim">on chain.</span>'), 'h1 abs')
  css(head, { fontSize: L(108, 112) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  const scrim = el('div', 'abs', root)
  css(scrim, { pointerEvents: 'none', left: 0, top: 0, bottom: 0, width: '900px', background: 'linear-gradient(90deg, rgba(10,10,10,.92) 40%, transparent)' })
  root.appendChild(head)
  let pts = null, dot = null, big0 = null
  return (t) => {
    if (!v.sr) return
    const wal = box(v, 'wal', '.st-wallet'), ch = box(v, 'chart', '.st-chart'), plot = box(v, 'plot', '.st-plot')
    // measure the line once: the stroke path is H/V steps, so y holds until the next x
    if (!pts) {
      const ps = $$(v, '.st-plot path')
      const d = ps.length ? ps[ps.length - 1].getAttribute('d') : ''
      pts = []
      let x = 0, y = 0
      for (const m of d.matchAll(/([MHV])([\d.]+)(?:,([\d.]+))?/g)) {
        if (m[1] === 'M') { x = +m[2]; y = +m[3]; pts.push([x, y]) } else if (m[1] === 'H') x = +m[2]; else { y = +m[2]; pts.push([x, y]) }
      }
      dot = document.createElement('span'); dot.className = 'st-dot'
      const pe = $(v, '.st-plot'); if (pe) pe.appendChild(dot)
    }
    const yAt = (px) => { let y = pts.length ? pts[0][1] : 150; for (const p of pts) if (p[0] <= px) y = p[1]; return y }
    const ws = [wal.x + wal.w / 2, wal.y + wal.h / 2], cs = [ch.x + ch.w / 2, ch.y + ch.h / 2]
    if (V) {
      stMask(v, 400, 520)
      camera(v, t, [[B1, 215, 281 + 400 / 2.85, 2.85], [B1 + 1.5, 215, 281 + 380 / 2.75, 2.75], [B1 + 2.15, 215, 452, 2.42], [B1 + 3.2, 215, 470, 2.42], [B1 + 3.7, 215, cs[1] - 60, 2.6], [B3, 215, cs[1] - 50, 2.64]])
    } else {
      css(v.wrap, { maskImage: 'none' })
      camera(v, t, [[B1, ws[0] - 250 / 2.15, ws[1], 2.15], [B1 + 1.6, ws[0] - 250 / 2.05, ws[1] + 4, 2.05], [B1 + 2.3, 900, ch.y + 150, 1.52], [B1 + 3.2, 920, ch.y + 150, 1.55], [B1 + 3.75, cs[0], cs[1] + 10, 1.9], [B3, cs[0] + 6, cs[1] + 12, 1.96]])
    }
    // the wallet card: a quick punch on the downbeat, then the count-up to its real value
    const big = $(v, '.st-big')
    if (big) {
      if (big0 == null) big0 = parseFloat(big.firstChild.textContent)
      big.firstChild.textContent = fmt(big0 * eOut(rng(t, B1 + 0.05, B1 + 1.2), 4), 3)
    }
    stText($(v, '.st-usd'), '$' + fmt(320.71 * eOut(rng(t, B1 + 0.2, B1 + 1.3), 4), 2))
    // 1h, 24h, all pop in on the beat
    $$(v, '.st-pills span').forEach((e, i) => { const p = pop(rng(t, B1 + 1.3 + i * SB / 2, B1 + 1.9 + i * SB / 2)); css(e, { opacity: clamp(p * 2), transform: `scale(${0.5 + 0.5 * p})`, display: 'inline-block' }) })
    // the chart draws left to right, the dot riding the head of the line
    const kd = eInOut(rng(t, L(B1 + 2.1, B1 + 1.0), L(B1 + 3.2, B1 + 2.6)))
    const pe = $(v, '.st-plot')
    if (pe) css(pe, { clipPath: `inset(-12px ${(1 - kd) * 100}% -12px -12px)` })
    $$(v, '.st-chart-top span').forEach((e, i) => css(e, { opacity: rng(t, L(B1 + 1.9, B1 + 0.8) + i * 0.2, L(B1 + 2.3, B1 + 1.2) + i * 0.2) }))
    // cursor: in from below, then scrubs the line from now back through the session
    const sx = (px) => onStage(v, plot.x + plot.w * px / 1000, plot.y + plot.h * yAt(px) / 300)
    const keysX = [[B1 + 3.85, 985], [B1 + 4.4, 760], [B1 + 4.85, 520], [B3 - 0.05, 330]]
    let scrub = null
    if (t >= keysX[0][0]) {
      scrub = keysX[0][1]
      for (let i = 0; i < keysX.length - 1; i++) if (t >= keysX[i][0]) scrub = lerp(keysX[i][1], keysX[i + 1][1], eInOut(rng(t, keysX[i][0], keysX[i + 1][0])))
    }
    const headX = scrub != null ? scrub : 1000 * kd
    if (dot) {
      css(dot, { left: (plot.w * headX) / 1000 + 'px', top: (plot.h * yAt(headX)) / 300 + 'px', opacity: kd > 0.01 ? 1 : 0, transform: `scale(${scrub != null ? 1.25 : 1})` })
    }
    if (v.cam) {
      const [a0, b0] = sx(985), [a1, b1] = sx(760), [a2, b2] = sx(520), [a3, b3] = sx(330)
      CURSOR = [[[B1 + 3.35, a0 + 200, b0 + 260], [B1 + 3.85, a0 + 2, b0 + 4], [B1 + 4.4, a1 + 2, b1 + 4], [B1 + 4.85, a2 + 2, b2 + 4], [B3 - 0.05, a3 + 2, b3 + 4]], []]
    }
    // the headline owns the empty side of the frame, then gives it back to the chart
    playWords(head, t, B1 + 0.12, 0.1, L(B1 + 1.95, B3 - 0.35))
    if (V) place(head, (W - head.offsetWidth) / 2, 120)
    else place(head, 104, H / 2 - head.offsetHeight / 2 - 10)
    css(scrim, { display: V ? 'none' : 'block', opacity: (1 - rng(t, B1 + 1.95, B1 + 2.4)) })
    css(v.wrap, { opacity: 1 - eIn(rng(t, B3 - 0.15, B3)) })
  }
})

// 3. tiles count up, then the open positions roll in and the cursor reads them; 4. best and worst
scene(B3, B6 + 0.02, (root) => {
  const v = uiView(root, V ? 'm-stats' : 'stats')
  const hA = words(root, L('Every trade, <span class="dim">counted.</span>', 'Every trade,<br><span class="dim">counted.</span>'), 'h1 abs')
  const hB = words(root, L('What he holds, <span class="dim">right now.</span>', 'What he holds,<br><span class="dim">right now.</span>'), 'h1 abs')
  const hC = words(root, L('He wins some. <span class="dim">He loses some.</span>', 'He wins some.<br><span class="dim">He loses some.</span>'), 'h1 abs')
  for (const h of [hA, hB, hC]) css(h, { fontSize: L(104, 108) + 'px', lineHeight: 1.04, textAlign: 'center' })
  let tv = null
  const T_POS = B4, T_BW = B5
  return (t) => {
    if (!v.sr) return
    const tiles = $$(v, '.st-tile'), rows = $$(v, '.pos-row'), bws = $$(v, '.st-bw-card')
    const tl = box(v, 'tiles', '.st-tiles'), ps = box(v, 'pos', '.pos'), bw = box(v, 'bw', '.st-bw')
    const head2 = box(v, 'h2pos', '.pg-sec-head', 0), head3 = box(v, 'h2bw', '.pg-sec-head', 1)
    if (!tv) {
      tv = tiles.map((e) => e.querySelector('b').textContent)
      // the site's cards ease their transform on hover; here video time drives it, so no CSS transition
      for (const e of [...tiles, ...rows, ...bws]) e.style.transition = 'none'
    }
    // measure everything the cursor needs before any piece is moved
    const rb = [0, 1, 2].map((i) => box(v, 'row' + i, '.pos-row', i))
    const cb = [0, 1, 2].map((i) => box(v, 'rc' + i, '.pos-coin', i))
    const gbx = box(v, 'goat', '.st-bw-card .st-bw-coin', 0)
    const bwb = [0, 1].map((i) => box(v, 'bwc' + i, '.st-bw-card', i))
    stMask(v, L(250, 400), L(360, 520))
    const sc = L(1.5, 2.45), sc2 = L(1.42, 2.45)
    const Y = L(390, 560) // where each section's top sits on screen, under the headline
    const tc = tl.y + (H / 2 - Y) / sc - L(20, 0), pc = head2.y + (H / 2 - Y) / sc2, bc = head3.y + (H / 2 - Y) / sc
    const cx = L(800, 215)
    camera(v, t, [[B3, cx, tc + L(40, 60), sc * 1.06], [B3 + 0.6, cx, tc, sc], [T_POS - 0.15, cx, tc - 6, sc * 1.01],
      [T_POS + 0.35, cx, pc, sc2], [T_POS + 1.2, cx, pc + L(10, 30), sc2], [T_BW - 0.15, cx, pc + L(80, 260), sc2 * 1.02],
      [T_BW + 0.35, cx, bc, sc], [B6, cx, bc + 10, sc * 1.03]])
    css(v.wrap, { opacity: 1 - eIn(rng(t, B6 - 0.2, B6)) })

    // tiles pop in on eighth notes; the numbers count up to the real values
    tiles.forEach((e, i) => {
      const t0 = B3 + 0.15 + i * SB / 2
      const p = pop(rng(t, t0, t0 + 0.6))
      css(e, { opacity: clamp(p * 2), transform: `translateY(${(1 - clamp(p)) * 40}px) scale(${0.85 + 0.15 * p})` })
      const k = eOut(rng(t, t0 + 0.05, t0 + 1.0), 3)
      const b = e.querySelector('b'), s = tv[i]
      let txt = s
      if (/^\d+$/.test(s)) txt = String(Math.round(+s * k))
      else if (/^\d+%$/.test(s)) txt = Math.round(parseInt(s) * k) + '%'
      else if (/^\+[\d.]+$/.test(s)) txt = '+' + fmt(parseFloat(s) * k, 4)
      else if (/^(\d+)h (\d+)m$/.test(s)) { const [, hh, mm] = s.match(/^(\d+)h (\d+)m$/); const m = Math.round((+hh * 60 + +mm) * k); txt = Math.floor(m / 60) + 'h ' + (m % 60) + 'm' }
      stText(b, txt)
    })
    // open positions: the rows roll in one by one
    cascade(rows, t, L(T_POS - 0.9, T_POS + 0.1), 0.1, 50)
    // best and worst: the cards slam in from either side, the percentages count
    bws.forEach((e, i) => {
      const k = expoOut(rng(t, T_BW + 0.1 + i * 0.16, T_BW + 0.7 + i * 0.16))
      css(e, { opacity: clamp(k * 1.6), transform: `translateX(${(1 - k) * (i ? 160 : -160)}px)` })
      const pct = e.querySelector('.st-bw-pct'), fin = i ? -47.5 : 26.2
      stText(pct, (fin > 0 ? '+' : '') + fmt(fin * eOut(rng(t, T_BW + 0.2 + i * 0.16, T_BW + 1.2 + i * 0.16), 3), 1) + '%')
    })

    // headlines, one per section
    playWords(hA, t, B3 + 0.1, 0.1, T_POS - 0.35)
    playWords(hB, t, T_POS + 0.2, 0.1, T_BW - 0.35)
    playWords(hC, t, T_BW + 0.15, 0.12, B6 - 0.3)
    for (const h of [hA, hB, hC]) place(h, (W - h.offsetWidth) / 2, L(118, 120))

    // the cursor: reads the positions row by row, then lands on the best trade
    if (v.cam) {
      const rowAt = (i, fx) => centre(v, rb[i], fx, 0.5)
      const coin = (i) => centre(v, cb[i], 0.55, 0.5)
      const [c0x, c0y] = coin(0), [c2x, c2y] = coin(2)
      const [p0x, p0y] = rowAt(0, L(0.93, 0.85)), [p2x, p2y] = rowAt(2, L(0.93, 0.85))
      const gb = centre(v, gbx, 0.55, 0.5)
      const path = t < T_BW
        ? [[T_POS + 0.85, c0x + 260, c0y + 340], [T_POS + 1.3, c0x, c0y], [T_POS + 1.75, p0x, p0y], [T_POS + 2.15, c2x, c2y], [T_BW - 0.1, p2x, p2y - 6]]
        : [[T_BW + 0.6, gb[0] + 300, gb[1] + 260], [T_BW + 1.15, gb[0], gb[1]], [B6 - 0.3, gb[0] + 10, gb[1] + 6]]
      CURSOR = [path, []]
      const [mx, my] = stCur(path, t)
      stGlow(v, [...rows.slice(0, 3).map((e, i) => [e, rb[i]]), ...bws.map((e, i) => [e, bwb[i]])], mx, my)
    }
    void ps; void bw
  }
})

// 5. end card: he lands, the logo, the feature line, grokgrid.fun
scene(B6, DURATION, (root) => {
  const hero = clipImg('hero'); root.appendChild(hero)
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(120, 130) + 'px' })
  const line = words(root, L('His numbers, <span class="hl-gain">on chain.</span>', 'His numbers,<br><span class="hl-gain">on chain.</span>'), 'h1 abs')
  css(line, { fontSize: L(76, 96) + 'px', textAlign: 'center', lineHeight: 1.05 })
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  css(url, { fontSize: L(26, 30) + 'px' })
  return (t) => {
    const hs = L(1100, 1300)
    // the clip's bot lands at about 72% down its frame
    const by = L(600, 1010)
    place(hero, (W - hs) / 2, by - hs * 0.72, hs, hs)
    playClip(hero, t, B6 - 0.15)
    css(hero, { opacity: rng(t, B6, B6 + 0.1) })
    const ms = L(104, 116)
    const kw = pop(rng(t, B6 + 0.2, B6 + 0.9))
    const rowW = ms + 22 + (word.offsetWidth || 480)
    const y = L(70, 300)
    place(mark, (W - rowW) / 2, y + 6, ms, ms)
    const blink = t > B6 + 2.4 && t < B6 + 2.56 ? 0.12 : 1
    const lk = eInOut(rng(t, B6 + 1.6, B6 + 2.0))
    mark.innerHTML = markSVG('house', 'sphere', lerp(0.45, -0.05, lk), lerp(-0.35, 0.1, lk), blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, B6 + 0.3, 0)
    place(word, (W - rowW) / 2 + ms + 22, y)
    playWords(line, t, B6 + 0.9, 0.1)
    place(line, (W - line.offsetWidth) / 2, L(H - 270, H - 560))
    const ku = expoOut(rng(t, B6 + 1.5, B6 + 2.2))
    place(url, (W - url.offsetWidth) / 2, L(H - 150, H - 290))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
  }
})
