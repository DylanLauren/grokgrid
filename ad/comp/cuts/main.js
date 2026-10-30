// The 40 s GrokGrid launch ad: nine scenes. Loaded by index.html after core.js when ?cut=main (the default).
const DURATION = 40

// 1. hook: "you sleep." / bot hops in / "he doesn't."
scene(0, 3.6, (root) => {
  const a = words(root, 'you sleep.', 'h1 abs')
  css(a, { fontSize: L(150, 150) + 'px' })
  const hero = clipImg('hero'); root.appendChild(hero)
  const hs = L(1250, 1400)
  place(hero, L(W * 0.37, W * 0.5) - hs / 2, L(H * 0.56, H * 0.56) - hs / 2, hs, hs)
  const b = words(root, 'he <span class="dim">doesn’t.</span>', 'h1 abs')
  css(b, { fontSize: L(150, 150) + 'px' })
  return (t) => {
    // "you sleep." centred, then it slides out of the way
    playWords(a, t, 0.15, 0.12, 1.25)
    css(a, { left: (W - a.offsetWidth) / 2 + 'px', top: (H - a.offsetHeight) / 2 + L(-20, -40) + 'px' })
    playClip(hero, t, 1.05)
    css(hero, { opacity: rng(t, 1.0, 1.1) })
    playWords(b, t, 2.35, 0.14, 3.25)
    if (V) place(b, (W - b.offsetWidth) / 2, H * 0.24)
    else place(b, W * 0.56, H * 0.5 - b.offsetHeight / 2 - 10)
  }
})

// 2. brand: mark with the family orbiting, GrokGrid, line
scene(3.4, 6.6, (root) => {
  const ring = el('div', 'marks', root)
  const minis = FAMILY.map(([c, s], i) => el('div', 'mark', ring, markSVG(c, s, Math.cos(i) * 0.5, Math.sin(i) * 0.4)))
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const ms = L(250, 300)
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(150, 150) + 'px' })
  const line = words(root, 'a Grok Bot that trades <span class="hl-gain">pump.fun</span>, live.', 'sub abs')
  css(line, { fontSize: L(42, 46) + 'px' })
  return (t) => {
    const k = pop(rng(t, 3.45, 4.25))
    const out = eIn(rng(t, 5.95, 6.35))
    const cx = W / 2, cy = L(H * 0.34, H * 0.36)
    place(mark, cx - ms / 2, cy - ms / 2, ms, ms)
    const blink = t > 4.9 && t < 5.06 ? 0.12 : 1
    const lk = eInOut(rng(t, 4.4, 4.8))
    mark.innerHTML = markSVG('house', 'sphere', lerp(0.45, -0.05, lk), lerp(-0.35, 0, lk), blink)
    css(mark, { transform: `scale(${k * (1 - out * 0.4)}) rotate(${(1 - k) * -40}deg)`, opacity: clamp(k * 3) * (1 - out) })
    playWords(word, t, 3.75, 0.0, 5.95)
    playWords(line, t, 4.3, 0.07, 5.9)
    place(word, (W - word.offsetWidth) / 2, cy + ms / 2 + L(26, 60))
    place(line, (W - line.offsetWidth) / 2, cy + ms / 2 + L(200, 250))
    minis.forEach((m, i) => {
      const a = (i / minis.length) * Math.PI * 2 + t * 0.45
      const r = L(300, 340) * backOut(rng(t, 3.6 + i * 0.05, 4.4 + i * 0.05)) * (1 + out * 0.8)
      const sz = L(86, 96)
      const fade = rng(t, 3.6 + i * 0.05, 3.9 + i * 0.05) * (1 - out)
      place(m, cx + Math.cos(a) * r * L(1.55, 1.25) - sz / 2, cy + Math.sin(a) * r * L(0.42, 0.6) - sz / 2, sz, sz)
      const behind = Math.sin(a) < 0
      css(m, { opacity: fade * (behind ? 0.55 : 1), transform: `scale(${behind ? 0.8 : 1}) rotate(${Math.sin(t * 2 + i) * 8}deg)`, zIndex: behind ? 0 : 2 })
    })
    css(mark, { zIndex: 1 })
  }
})

// 3. trading: bot with his phone, trade chips, the win
scene(6.4, 11.0, (root) => {
  const ph = clipImg('phone'); root.appendChild(ph)
  const ps = L(1300, 1500)
  const head = words(root, L('He trades <span class="hl-gain">pump.fun</span>', 'He trades<br><span class="hl-gain">pump.fun</span>'), 'h1 abs')
  css(head, { fontSize: L(104, 132) + 'px', textAlign: 'center' })
  const sub = words(root, 'all day, from his own phone.', 'sub abs')
  css(sub, { fontSize: L(42, 44) + 'px' })
  const buy = el('div', 'chip', root, `<div class="ic" style="background:#1683ff;color:#fff">HD</div><div><div class="t1">$HYPEDOG <span class="tag buy">BUY</span></div><div class="t2">0.02 SOL · just now</div></div>`)
  const win = el('div', 'chip', root, `<div class="ic" style="background:rgba(74,222,128,.15);color:#4ade80">TP</div><div><div class="t1"><span class="hl-gain">+60%</span> take profit</div><div class="t2">$HYPEDOG · sold</div></div>`)
  const bub = el('div', 'bubble', root, 'watch me trade!')
  return (t) => {
    const T0 = 6.55
    playClip(ph, t, T0)
    const enter = expoOut(rng(t, 6.4, 7.0))
    const out = eIn(rng(t, 10.55, 11.0))
    const px = L(W * 0.43 - ps / 2, W / 2 - ps * 0.47), py = L(H * 0.6 - ps / 2, H * 0.6 - ps / 2)
    place(ph, px + (1 - enter) * L(-200, 0), py + (1 - enter) * L(0, 120), ps, ps)
    css(ph, { opacity: enter * (1 - out) })
    playWords(head, t, 6.6, 0.1, 10.5)
    playWords(sub, t, 7.05, 0.06, 10.5)
    if (V) { place(head, (W - head.offsetWidth) / 2, 230); place(sub, (W - sub.offsetWidth) / 2, 530) }
    else { place(head, 90, 110); place(sub, 94, 236) }
    // chips sit next to the phone screen
    const cx = px + ps * 0.72, cy = py + ps * 0.34
    const kb = pop(rng(t, 7.6, 8.3)), ob = rng(t, 8.85, 9.1)
    css(buy, { left: cx + L(40, -380) + 'px', top: cy + L(-10, -130) + 'px', opacity: clamp(kb * 3) * (1 - ob), transform: `scale(${0.6 + 0.4 * kb}) translateY(${-ob * 30}px)` })
    const kw = pop(rng(t, 8.95, 9.6))
    css(win, { left: cx + L(40, -380) + 'px', top: cy + L(-10, -130) + 'px', opacity: clamp(kw * 3) * (1 - out), transform: `scale(${0.6 + 0.4 * kw})` })
    const kbub = pop(rng(t, 9.25, 9.9))
    css(bub, { left: px + ps * L(0.2, 0.16) + 'px', top: py + ps * L(0.24, 0.24) + 'px', opacity: clamp(kbub * 3) * (1 - out), transform: `scale(${kbub})` })
  }
})

// 4. his calls: the real Calls panel fills in card by card beside him
scene(10.8, 16.0, (root) => {
  const bot = clipImg('phone'); root.appendChild(bot)
  const v = uiView(root, V ? 'm-calls' : 'calls')
  const head = words(root, 'Every trade,<br><span class="dim">called out loud.</span>', 'h1 abs')
  css(head, { fontSize: L(96, 104) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  return (t) => {
    if (!v.sr) return
    const panel = box(v, 'panel', 'aside.panel'), first = box(v, 'first', '.pn-item')
    const k = expoOut(rng(t, 10.8, 11.6)), out = eIn(rng(t, 15.55, 16.0))
    if (V) camera(v, t, [[10.8, 215, 354, 2.2], [13.4, 215, 370, 2.22], [14.4, 215, first.y + first.h * 0.5, 2.9], [16, 215, first.y + first.h * 0.5 + 10, 2.98]])
    else camera(v, t, [[10.8, 830, 520, 1.25], [13.3, 842, 520, 1.28], [14.4, panel.x + panel.w * 0.5, first.y + first.h * 0.5 + 60, 1.95], [16, panel.x + panel.w * 0.5 - 6, first.y + first.h * 0.5 + 66, 2.02]])
    css(v.wrap, { opacity: (1 - out) })
    // vertical: the headline owns the top, the UI fades in under it
    if (V) css(v.wrap, { maskImage: 'linear-gradient(transparent 330px, #000 470px)', webkitMaskImage: 'linear-gradient(transparent 330px, #000 470px)' })
    // the panel slides in from the right like on the site, then the calls land one by one
    const pe = $(v, 'aside.panel')
    if (pe) css(pe, { transform: `translateX(${(1 - k) * 420}px)`, opacity: clamp(k * 1.5) })
    cascade($$(v, '.pn-item'), t, 11.2, 0.28, 60)
    // him, trading on his phone in the room the panel sits over
    playClip(bot, t, 10.8, { loop: true })
    // he sits in the room where the site's own 3D bot is, so he moves with the camera
    const bs = 760 * v.cam[2]
    const [bx, by] = onStage(v, 560, 640)
    place(bot, bx - bs * 0.5, by - bs * 0.5, bs, bs)
    css(bot, { opacity: V ? 0 : clamp(k * 2) * (1 - out) })
    playWords(head, t, 11.1, 0.1, 13.5)
    if (V) place(head, (W - head.offsetWidth) / 2, 110)
    else place(head, 96, 120)
    // the cursor comes to rest on the newest call (its real hover style shows)
    const [fx, fy] = centre(v, first, 0.6, 0.35)
    CURSOR = [[[13.9, fx + 260, fy + 320], [14.7, fx, fy], [15.6, fx + 6, fy + 4]], []]
  }
})

// 5. his numbers: the real stats page, the wallet counting up and the chart drawing itself
scene(15.8, 20.2, (root) => {
  const v = uiView(root, V ? 'm-stats' : 'stats')
  let target = null
  return (t) => {
    if (!v.sr) return
    const title = box(v, 'title', '.pg-head h1, h1'), wal = box(v, 'wallet', '.st-wallet'), chart = box(v, 'chart', '.st-chart')
    const tiles = $$(v, '.st-tile'), rows = $$(v, '.pos-row')
    const tl = box(v, 'tiles', '.st-tile', 0), pr = box(v, 'rows', '.pos-row', 0)
    const k = expoOut(rng(t, 15.8, 16.6)), out = eIn(rng(t, 19.8, 20.2))
    void title; void wal; void chart
    const top = title.y - 40
    if (V) camera(v, t, [[15.8, 215, top + 380, 2.3], [16.9, 215, top + 400, 2.3], [17.8, 215, chart.y + chart.h * 0.5, 2.3], [18.9, 215, tl.y + 120, 2.3], [20.2, 215, pr.y + 160, 2.2]])
    else camera(v, t, [[15.8, 760, top + 300, 1.62], [16.9, 770, top + 320, 1.6], [17.8, 796, chart.y + chart.h * 0.5, 1.5], [18.9, 800, tl.y + 80, 1.4], [20.2, 800, pr.y + 120, 1.34]])
    pageIn(v, t, 15.85)
    css(v.wrap, { opacity: clamp(k * 2) * (1 - out) })
    // the wallet counts up to its real value
    const big = $(v, '.st-big')
    if (big) {
      if (target == null) target = parseFloat(big.firstChild.textContent)
      big.firstChild.textContent = fmt(target * eOut(rng(t, 16.9, 18.0), 4), 3)
    }
    // the chart draws left to right
    const plot = $(v, '.st-plot')
    if (plot) css(plot, { clipPath: `inset(0 ${(1 - eInOut(rng(t, 17.0, 18.4))) * 100}% 0 0)` })
    cascade([...$$(v, '.st-pills span')], t, 17.6, 0.08, 14)
    cascade(tiles, t, 18.2, 0.07, 40)
    cascade(rows, t, 19.1, 0.08, 40)
    const [cx, cy] = centre(v, chart, 0.25, 0.55), [dx, dy] = centre(v, chart, 0.85, 0.45)
    CURSOR = [[[17.3, cx + 120, cy + 300], [17.9, cx, cy], [18.7, dx, dy], [19.4, dx + 40, dy + 200]], []]
  }
})

// 6. launch your own: the real Grid page; the cursor picks violet and names it, then the family runs
scene(20.0, 25.4, (root) => {
  const v = uiView(root, V ? 'm-grid' : 'grid')
  const run = clipImg('family_run'); root.appendChild(run)
  const run2 = words(root, L('Pick a colour. <span class="hl-violet">Launch.</span> Done.', 'Pick a colour.<br><span class="hl-violet">Launch.</span> Done.'), 'h1 abs')
  css(run2, { fontSize: L(110, 120) + 'px', textAlign: 'center' })
  const rw = L(W * 1.0, W * 1.5)
  const NAME = 'night shift'
  const PICK = 4 // violet
  let swapped = false
  return (t) => {
    if (!v.sr) return
    const title = box(v, 'title', 'h1'), line = box(v, 'line', '.gd-line'), pick = box(v, 'pick', '.gd-pick', PICK), name = box(v, 'name', 'input[placeholder="night shift"]')
    const side = box(v, 'side', '.gd-side')
    const k = expoOut(rng(t, 20.0, 20.7)), out = eIn(rng(t, 22.95, 23.4))
    void title; void line; void name
    const gtop = title.y - 40, ly = line.y + line.h * 0.5, nmy = name.y + name.h * 0.5
    if (V) camera(v, t, [[20.0, 215, gtop + 400, 2.2], [20.8, 215, ly, 2.0], [21.85, 215, ly + 10, 2.02], [22.35, 215, nmy - 80, 2.0], [23.4, 215, nmy - 70, 2.05]])
    else camera(v, t, [[20.0, 760, gtop + 290, 1.6], [20.8, 790, ly + 40, 1.36], [21.85, 795, ly + 50, 1.38], [22.35, 760, nmy - 40, 1.5], [23.4, 765, nmy - 35, 1.55]])
    pageIn(v, t, 20.05)
    css(v.wrap, { opacity: clamp(k * 2) * (1 - out) })
    // the picker bots pop in left to right
    $$(v, '.gd-pick').forEach((e, i) => { const p = pop(rng(t, 20.4 + i * 0.06, 21.0 + i * 0.06)); e.style.transform = `scale(${0.4 + 0.6 * p})`; e.style.opacity = clamp(p * 2) })
    // click: violet becomes the pick, the preview bot becomes violet
    if (t >= 21.6 && !swapped) {
      swapped = true
      $$(v, '.gd-pick').forEach((e, i) => { e.classList.toggle('on', i === PICK); e.setAttribute('aria-checked', String(i === PICK)) })
      const from = $$(v, '.gd-pick')[PICK].querySelector('.lb'), to = $(v, '.gd-side .lb')
      if (from && to) { const c = from.cloneNode(true); c.style.cssText = to.style.cssText; c.setAttribute('class', to.getAttribute('class').replace(/lb-\w+/, from.className.match(/lb-\w+/)?.[0] || '')); to.replaceWith(c) }
      // the coin picture is the picked bot on the site's light tile, so it turns violet too
      const sv = $$(v, '.gd-pick')[PICK].querySelector('svg')
      if (sv) {
        const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -14 128 128"><rect x="-14" y="-14" width="128" height="128" fill="#f2f3f5"/>${sv.innerHTML}</svg>`
        $$(v, 'img[src^="data:image/svg"]').forEach((im) => { im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art) })
      }
    }
    if (t < 21.6 && swapped) swapped = false // scrubbing backwards in previews
    // typing the name: field, preview card and coin card all follow, ticker fills itself
    const n = clamp(Math.floor((t - 22.45) / 0.05), 0, NAME.length)
    const typed = NAME.slice(0, n)
    const inp = $(v, 'input[placeholder="night shift"]')
    if (inp) { inp.value = typed; inp.setAttribute('value', typed) }
    const tk = $(v, 'input[placeholder="NIGHT"]')
    if (tk) tk.value = typed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
    const pv = $(v, '.gd-side b'); if (pv) pv.textContent = typed || 'your bot'
    const cn = $(v, '.gd-coin-top b'); if (cn) cn.textContent = typed || 'coin name'
    const ct = $(v, '.gd-coin-top span'); if (ct) ct.textContent = '$' + (typed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'TICKER')
    if (inp && n > 0 && n < NAME.length + 1) inp.focus()
    const [px, py] = centre(v, pick, 0.5, 0.45), [nx, ny] = centre(v, name, 0.25, 0.5)
    CURSOR = [[[20.95, px + 300, py + 260], [21.5, px, py], [21.9, px + 4, py + 2], [22.3, nx, ny], [22.95, nx + 30, ny + 26]], [21.6, 22.32]]
    void side
    // then the page clears and the family runs across
    playWords(run2, t, 23.15, 0.08, 25.0)
    place(run2, (W - run2.offsetWidth) / 2, L(150, 330))
    playClip(run, t, 22.9)
    const rk = rng(t, 22.9, 23.0) * (1 - rng(t, 25.05, 25.4))
    const rh = rw * 900 / 1600
    place(run, (W - rw) / 2, L(H * 0.62 - rh * 0.5, H * 0.58 - rh * 0.5), rw, rh)
    css(run, { opacity: rk })
  }
})

// 7. the fee loop
scene(25.2, 30.0, (root) => {
  const head = words(root, 'Where the <span class="hl-orange">fees</span> go.', 'h1 abs')
  css(head, { fontSize: L(100, 120) + 'px' })
  const coin = el('div', 'coin', root, `<div style="width:52px;height:52px">${markSVG('#13b8a6', 'squircle')}</div>your bot’s coin <span class="mono dim" style="font-size:20px">creator fees</span>`)
  const sp = el('div', 'split', root)
  const bar = el('div', 'bar', sp)
  const a = el('div', 'seg a', bar, '<span class="pa">80%</span>')
  const b = el('div', 'seg b', bar, '<span class="pb">20%</span>')
  const la = el('div', 'lab', sp, 'trades for your bot')
  const lb = el('div', 'lab', sp, 'buys + burns <b style="color:#ff6a00">$GRID</b>')
  const line = el('div', 'abs', root)
  css(line, { width: '3px', background: 'linear-gradient(#fff, rgba(255,255,255,.1))' })
  const fl = el('div', 'flame', root, `<svg viewBox="0 0 40 52" width="100%" height="100%"><path d="M20 2c4 10 16 16 16 30a16 16 0 0 1-32 0c0-8 5-12 8-17c1 5 3 7 5 8c0-8-1-14 3-21z" fill="#ff6a00"/><path d="M20 22c3 6 9 9 9 16a9 9 0 0 1-18 0c0-4 3-7 5-10c1 3 2 4 3 4c0-4 0-7 1-10z" fill="#ffb27a"/></svg>`)
  return (t) => {
    playWords(head, t, 25.3, 0.1, 29.6)
    const bw = L(1480, 940)
    if (V) place(head, (W - head.offsetWidth) / 2, 380)
    else place(head, (W - head.offsetWidth) / 2, 120)
    const kc = pop(rng(t, 25.75, 26.4))
    const out = eIn(rng(t, 29.55, 30.0))
    const cy = L(350, 700)
    css(coin, { left: (W - coin.offsetWidth) / 2 + 'px', top: cy + 'px', opacity: clamp(kc * 3) * (1 - out), transform: `scale(${kc})` })
    // fee stream drops into the bar
    const ks = eOut(rng(t, 26.3, 26.8))
    const by = L(660, 1000)
    css(line, { left: W / 2 - 1.5 + 'px', top: cy + 80 + 'px', height: (by - cy - 80) * ks + 'px', opacity: 1 - out })
    const fill = expoOut(rng(t, 26.8, 27.8))
    place(sp, (W - bw) / 2, by, bw)
    css(sp, { opacity: rng(t, 26.7, 26.9) * (1 - out) })
    css(bar, { width: bw + 'px' })
    css(a, { width: bw * 0.8 * fill + 'px' })
    css(b, { width: bw * 0.2 * expoOut(rng(t, 27.4, 28.2)) + 'px' })
    a.querySelector('.pa').textContent = Math.round(80 * fill) + '%'
    b.querySelector('.pb').textContent = Math.round(20 * expoOut(rng(t, 27.4, 28.2))) + '%'
    css(la, { left: '6px', top: '120px', opacity: rng(t, 27.7, 28.1), transform: `translateY(${(1 - eOut(rng(t, 27.7, 28.2))) * 14}px)` })
    css(lb, { left: bw * 0.8 + 6 + 'px', top: L(120, 170) + 'px', opacity: rng(t, 28.1, 28.5), transform: `translateY(${(1 - eOut(rng(t, 28.1, 28.6))) * 14}px)` })
    // flame flickers above the burn segment
    const kf = pop(rng(t, 28.2, 28.8))
    const fs = 70
    css(fl, { left: (W - bw) / 2 + bw * 0.9 - fs / 2 + 'px', top: by - fs - 14 + 'px', width: fs + 'px', height: fs * 1.3 + 'px', opacity: clamp(kf * 3) * (1 - out), transform: `scale(${kf * (1 + 0.06 * Math.sin(t * 19))}, ${kf * (1 + 0.1 * Math.sin(t * 23 + 1))})`, transformOrigin: '50% 100%' })
  }
})

// 8. the matrix: a wall of bots, a count
scene(29.8, 33.6, (root) => {
  const cols = L(14, 8), rows = L(7, 13)
  const size = L(104, 104), gap = L(22, 22)
  const marks = []
  const wall = el('div', 'marks', root)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = (r * 7 + c * 3 + ((r * c) % 5)) % FAMILY.length
    const [col, sh] = FAMILY[i]
    const lx = Math.sin(r * 1.7 + c) * 0.6, ly = Math.cos(c * 1.3 + r) * 0.4
    const m = el('div', 'mark', wall, markSVG(col, sh, lx, ly))
    m._rc = [r, c]
    marks.push(m)
  }
  const head = words(root, L('A whole family <span class="hl-violet">trading.</span>', 'A whole family<br><span class="hl-violet">trading.</span>'), 'h1 abs')
  css(head, { fontSize: L(120, 130) + 'px', textAlign: 'center' })
  const veil = el('div', 'abs', root)
  css(veil, { inset: 0, background: 'radial-gradient(42% 26% at 50% 50%, rgba(10,10,10,.97) 40%, rgba(10,10,10,.6) 75%, rgba(10,10,10,.0))' })
  root.appendChild(head)
  return (t) => {
    const gw = cols * size + (cols - 1) * gap, gh = rows * size + (rows - 1) * gap
    const x0 = (W - gw) / 2, y0 = (H - gh) / 2
    const out = eIn(rng(t, 33.2, 33.6))
    marks.forEach((m) => {
      const [r, c] = m._rc
      const d = Math.hypot(r - rows / 2, (c - cols / 2) * L(0.6, 1)) * 0.06
      const k = pop(rng(t, 29.9 + d, 30.5 + d))
      place(m, x0 + c * (size + gap), y0 + r * (size + gap) + Math.sin(t * 3 + r + c) * 3, size, size)
      css(m, { opacity: clamp(k * 3) * (1 - out), transform: `scale(${k * (1 - out * 0.3)})` })
    })
    playWords(head, t, 30.4, 0.12, 33.1)
    place(head, (W - head.offsetWidth) / 2, (H - head.offsetHeight) / 2)
    css(veil, { opacity: rng(t, 30.2, 30.6) * (1 - out) })
  }
})

// 9. end card: the family drops in around him, logo, CTA
scene(33.4, 40, (root) => {
  const lu = clipImg(V ? 'lineup_v' : 'lineup'); root.appendChild(lu)
  const lw = L(2000, 1380), lh = V ? lw : lw * 900 / 1600
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(140, 140) + 'px' })
  const cta = el('div', 'cta', root, `Launch your bot <svg width="26" height="26" viewBox="0 0 26 26"><path d="M6 13h14M14 7l6 6-6 6" stroke="#0a0a0a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`)
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  const tick = el('div', 'abs mono dim', root, '$GRID · pump.fun')
  css(tick, { fontSize: '22px' })
  return (t) => {
    playClip(lu, t, 33.5)
    const k = rng(t, 33.45, 33.55)
    place(lu, (W - lw) / 2, L(-160, H * 0.53 - 0.55 * lh), lw, lh)
    css(lu, { opacity: k })
    const ms = 120
    const kw = pop(rng(t, 35.0, 35.8))
    const rowW = ms + 26 + (word.offsetWidth || 500)
    const y = L(56, 330)
    place(mark, (W - rowW) / 2, y + 8, ms, ms)
    const blink = t > 37.2 && t < 37.36 ? 0.12 : 1
    mark.innerHTML = markSVG('house', 'sphere', 0.45 - 0.5 * eInOut(rng(t, 36.2, 36.6)), -0.35 + 0.3 * eInOut(rng(t, 36.2, 36.6)), blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, 35.1, 0)
    place(word, (W - rowW) / 2 + ms + 26, y)
    const kc = pop(rng(t, 35.9, 36.6))
    place(cta, (W - cta.offsetWidth) / 2, L(H - 330, H - 430))
    css(cta, { opacity: clamp(kc * 3), transform: `scale(${0.6 + 0.4 * kc})` })
    const ku = expoOut(rng(t, 36.3, 37.0))
    place(url, (W - url.offsetWidth) / 2, L(H - 215, H - 310))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
    place(tick, (W - tick.offsetWidth) / 2, L(H - 60, H - 150))
    css(tick, { opacity: rng(t, 36.8, 37.4) })
  }
})

