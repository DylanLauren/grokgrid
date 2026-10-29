// "Watch him trade, live": Grok Bot at his desk on the home page; switch between his room and his phone.
// 100 bpm, one bar = 2.4 s: cuts land on 2.4 (his room), 9.6 (his phone), 14.4 (room or phone), 16.8 (end card).
const DURATION = 21.6

// the phone clip: where his phone and his body sit inside the frame (fractions of the clip size)
const PH_PHONE = [0.64, 0.5]

// a small "live" pill with a pulsing red dot (the stream status)
function livePill(parent, label) {
  const p = el('div', 'chip', parent, `<span class="ldot" style="width:14px;height:14px;border-radius:50%;background:#ff3b3b;box-shadow:0 0 0 0 rgba(255,59,59,.5)"></span><span style="font:600 22px 'Geist Mono';letter-spacing:.06em">LIVE</span>${label ? `<span style="font:500 20px 'Geist Mono';color:rgba(255,255,255,.55)">${label}</span>` : ''}`)
  css(p, { padding: '12px 20px', gap: '12px', borderRadius: '999px', transformOrigin: '50% 50%' })
  return p
}
function pulse(p, t) {
  const d = p.querySelector('.ldot')
  const k = (t * 1.25) % 1
  css(d, { boxShadow: `0 0 0 ${k * 14}px rgba(255,59,59,${(0.55 * (1 - k)).toFixed(3)})` })
}
// numbers in the real stats strip count up to their real values
function countUp(e, k) {
  if (!e) return
  if (e._txt == null) e._txt = e.textContent
  const m = /([-+]?)(\d+(?:\.\d+)?)/.exec(e._txt)
  if (!m) return
  const dec = (m[2].split('.')[1] || '').length
  e.textContent = e._txt.replace(m[0], m[1] + (parseFloat(m[2]) * k).toFixed(dec))
}

// 1. hook: "Watch him trade." / he hops in / LIVE
scene(0, 2.5, (root) => {
  const head = words(root, L('Watch him <span class="hl-gain">trade.</span>', 'Watch him<br><span class="hl-gain">trade.</span>'), 'h1 abs')
  css(head, { fontSize: L(150, 150) + 'px', textAlign: 'center' })
  const hero = clipImg('hero'); root.appendChild(hero)
  const hs = L(1450, 1700)
  const live = livePill(root)
  return (t) => {
    const out = eIn(rng(t, 2.1, 2.5))
    playWords(head, t, 0.4, 0.13, 2.15)
    place(head, (W - head.offsetWidth) / 2, L(110, 300))
    playClip(hero, t, -0.5)
    const hx = W / 2 - hs / 2, hy = L(H * 0.62, H * 0.62) - hs / 2
    place(hero, hx, hy, hs, hs)
    css(hero, { opacity: 1 - out, transform: `scale(${1 + out * 0.15})` })
    // the live dot pops in over his head as he lands
    const k = pop(rng(t, 1.25, 1.85))
    place(live, W / 2 - (live.offsetWidth || 150) / 2, hy + hs * 0.34 - L(40, 60))
    css(live, { opacity: clamp(k * 3) * (1 - out), transform: `scale(${0.4 + 0.6 * k})` })
    pulse(live, t)
  }
})

// 2. his room: the real desk page builds around him, the cursor finds "his phone"
scene(2.4, 9.7, (root) => {
  const v = uiView(root, V ? 'm-desk' : 'desk')
  const bot = clipImg('phone'); root.appendChild(bot)
  const head = words(root, L('His desk is<br><span class="dim">the home page.</span>', 'His desk is<br><span class="dim">the home page.</span>'), 'h1 abs')
  css(head, { fontSize: L(96, 104) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  const head2 = words(root, 'Tap <span class="hl-gain">his phone.</span>', 'h1 abs')
  css(head2, { fontSize: L(110, 112) + 'px', textAlign: 'center' })
  const flash = el('div', 'flash', root)
  let fixed = false, switched = false
  // where the bot sits in the room, in UI pixels (the site's own 3D room is drawn by Blender here)
  const S = L(820, 380)
  const PHONE = L([740, 520], [222, 440])
  const WATCH = [PHONE[0] + S * 0.075, PHONE[1] - S * 0.1]
  return (t) => {
    if (!v.sr) return
    if (!fixed) {
      fixed = true
      const st = document.createElement('style')
      st.textContent = `.dock-card, .watch, .watch-line::before { animation: none !important; } .ph-wrap { display: none !important; } .calls-dock, .dock-card, .watch, .views, .strip, .fine { transition: none !important; }`
      v.sr.appendChild(st)
    }
    const tg = box(v, 'views', '.views'), b2 = box(v, 'b2', '.views button', 1)
    const k = expoOut(rng(t, 2.4, 3.2))
    // camera: lands wide on the page, settles, then pushes into the room/phone toggle, then dives into his phone
    const tx = tg.x + tg.w / 2, ty = tg.y + tg.h / 2
    const dive = eIn(rng(t, 9.1, 9.62), 2.4)
    if (V) camera(v, t, [[2.4, 230, 420, 2.7], [3.6, 215, 470, 2.02], [6.7, 215, 476, 2.08], [7.4, tx, ty - 120, 3.4], [9.0, tx + 4, ty - 110, 3.55]])
    else camera(v, t, [[2.4, 740, 560, 1.6], [3.4, 800, 500, 1.08], [4.8, 800, 500, 1.08], [5.7, 780, 545, 1.82], [6.7, 785, 548, 1.88], [7.4, tx, ty - 70, 3.9], [9.0, tx + 6, ty - 66, 4.05]])
    // the dive: zoom further toward his phone
    if (dive > 0) {
      const [cx, cy, sc] = v.cam
      const tgt = PHONE
      const ns = sc * (1 + dive * 5)
      const ncx = lerp(cx, tgt[0], eOut(dive, 2)), ncy = lerp(cy, tgt[1], eOut(dive, 2))
      v.cam = [ncx, ncy, ns]
      css(v.host, { transform: `translate(${W / 2 - ncx * ns}px, ${H / 2 - ncy * ns}px) scale(${ns})` })
    }
    css(v.wrap, { opacity: clamp(k * 2) * (1 - rng(t, 9.12, 9.4)), filter: dive > 0 ? `blur(${dive * 6}px)` : 'none' })
    // the header drops in, the tabs land one by one with "desk" lit
    const bar = $(v, 'header.bar')
    if (bar) css(bar, { transform: `translateY(${(1 - expoOut(rng(t, 2.5, 3.2))) * -70}px)`, opacity: rng(t, 2.5, 2.8) })
    cascade($$(v, 'nav.tabs button'), t, 2.7, 0.06, 18)
    // the latest calls rise in at the bottom left, the stats strip on the right counts up
    cascade($$(v, '.dock-card'), t, 3.1, 0.14, 40)
    cascade($$(v, 'dl.strip > div'), t, 3.3, 0.08, 30)
    $$(v, 'dl.strip dd').forEach((e, i) => countUp(e, eOut(rng(t, 3.4 + i * 0.08, 4.6), 3)))
    // the room/phone toggle
    const vw = $(v, '.views')
    const kv = pop(rng(t, 3.6, 4.3))
    if (vw) css(vw, { transform: `scale(${0.6 + 0.4 * kv})`, opacity: clamp(kv * 3) })
    // him at his desk, trading on his phone; he moves with the camera
    playClip(bot, t, 2.4, { loop: true })
    const bs = S * v.cam[2]
    const [px, py] = onStage(v, PHONE[0], PHONE[1])
    place(bot, px - bs * PH_PHONE[0], py - bs * PH_PHONE[1], bs, bs)
    css(bot, { opacity: clamp(k * 2) * (1 - dive * 0.2), filter: dive > 0 ? `blur(${dive * 8}px)` : 'none' })
    // the site's "Watch me trade!" pointer sits on his phone (its dot on the screen)
    const w = $(v, '.watch')
    if (w) {
      const wb = box(v, 'watch', '.watch')
      const kw = pop(rng(t, 4.3, 5.0))
      w.style.translate = `calc(50% + ${WATCH[0] - wb.x}px) ${WATCH[1] - (wb.y + wb.h / 2)}px`
      const line = w.querySelector('.watch-line'), pill = w.querySelector('.watch-pill')
      css(line, { transform: `scaleX(${eOut(rng(t, 4.3, 4.6))})`, transformOrigin: '0 50%' })
      css(pill, { opacity: clamp(kw * 3), transform: `scale(${(0.5 + 0.5 * kw) * (t > 6.0 && t < 7.2 ? 1.08 : 1)})` })
      w.style.opacity = 1 - rng(t, 7.0, 7.3)
      w.querySelector('.watch-line').style.setProperty('opacity', 1)
      const dot = (t * 0.625) % 1
      line.style.boxShadow = 'none'
      void dot
    }
    // click "his phone": the toggle swaps, the calls dock steps aside like on the site
    if (t >= 8.4 && !switched) {
      switched = true
      $$(v, '.views button').forEach((e, i) => { e.classList.toggle('on', i === 1); e.setAttribute('aria-pressed', String(i === 1)) })
    }
    if (t < 8.4 && switched) {
      switched = false
      $$(v, '.views button').forEach((e, i) => { e.classList.toggle('on', i === 0); e.setAttribute('aria-pressed', String(i === 0)) })
    }
    const dock = $(v, '.calls-dock')
    if (dock) dock.style.opacity = 1 - (V ? rng(t, 6.9, 7.2) : rng(t, 8.45, 8.75))
    const fine = $(v, 'footer.fine'); if (fine) fine.style.opacity = 1 - rng(t, 6.9, 7.2)
    // headlines
    playWords(head, t, 2.75, 0.1, L(4.85, 6.75))
    if (V) place(head, (W - head.offsetWidth) / 2, 250)
    else place(head, 96, 150)
    playWords(head2, t, 7.35, 0.1, 9.05)
    if (V) place(head2, (W - head2.offsetWidth) / 2, H * 0.5 - 160)
    else place(head2, (W - head2.offsetWidth) / 2, H * 0.5 - 220)
    // cursor: rests on his "Watch me trade!" pointer, then goes down and taps "his phone"
    const [wx, wy] = onStage(v, WATCH[0] + 100, WATCH[1] + 2)
    const [bx, by] = centre(v, b2, 0.45, 0.55)
    if (t < 7.2) CURSOR = [[[5.4, wx + 220, wy + 260], [6.0, wx, wy], [6.9, wx + 8, wy + 6]], []]
    else CURSOR = [[[7.25, bx + 260, by - 300], [7.95, bx, by], [8.75, bx + 4, by + 2]], [8.4]]
    css(flash, { opacity: eIn(rng(t, 9.3, 9.6), 2) * 0.95 })
  }
})

// 3. his phone: the phone point of view, a buy, a win
scene(9.6, 14.5, (root) => {
  const ph = clipImg('phone'); root.appendChild(ph)
  const ps = L(1500, 1300)
  const head = words(root, L('His phone.<br><span class="hl-gain">His trades.</span>', 'His phone.<br><span class="hl-gain">His trades.</span>'), 'h1 abs')
  css(head, { fontSize: L(112, 124) + 'px', lineHeight: 1.04, textAlign: L('left', 'center') })
  const live = livePill(root, 'his phone')
  const buy = el('div', 'chip', root, `<div class="ic" style="background:#1683ff;color:#0a0a0a">J</div><div><div class="t1">$JOB <span class="tag buy">BUY</span></div><div class="t2">0.26 SOL · just now</div></div>`)
  const win = el('div', 'chip', root, `<div class="ic" style="background:rgba(74,222,128,.15);color:#4ade80">TP</div><div><div class="t1"><span class="hl-gain">+25%</span> sold into strength</div><div class="t2">$JOB · +$11.80</div></div>`)
  const bub = el('div', 'bubble', root, 'not greedy today.')
  const flash = el('div', 'flash', root)
  return (t) => {
    playClip(ph, t, 9.6)
    const enter = expoOut(rng(t, 9.6, 10.3))
    const out = eIn(rng(t, 14.05, 14.5))
    // he fills the frame: the camera is right at his desk
    const zoom = 1 + 0.06 * eInOut(rng(t, 9.6, 14.5))
    const s = ps * zoom * (1.25 - 0.25 * enter)
    const ax = L(W * 0.42, W * 0.55), ay = L(H * 0.66, H * 0.56)
    const px = ax - s / 2, py = ay - s / 2
    place(ph, px, py, s, s)
    css(ph, { opacity: clamp(enter * 2) * (1 - out) })
    css(flash, { opacity: 0.9 * (1 - rng(t, 9.6, 9.95)) })
    playWords(head, t, 9.85, 0.1, 14.0)
    if (V) place(head, (W - head.offsetWidth) / 2, 210)
    else place(head, W - head.offsetWidth - 100, 110)
    const kl = pop(rng(t, 10.0, 10.6))
    if (V) place(live, (W - live.offsetWidth) / 2, 120)
    else place(live, 90, 80)
    css(live, { opacity: clamp(kl * 3) * (1 - out), transform: `scale(${0.5 + 0.5 * kl})` })
    pulse(live, t)
    // chips stack beside his phone screen
    const sx = px + s * PH_PHONE[0], sy = py + s * PH_PHONE[1]
    const cx = L(sx + 230, W / 2 - 260), cy = L(sy - 20, sy + s * 0.38)
    const kb = pop(rng(t, 10.8, 11.4)), ob = expoOut(rng(t, 12.0, 12.4))
    css(buy, { left: cx + 'px', top: cy - ob * L(130, 160) + 'px', opacity: clamp(kb * 3) * (1 - out) * (1 - ob * 0.45), transform: `scale(${L(1.3, 1.6) * (0.6 + 0.4 * kb) * (1 - ob * 0.08)})` })
    const kw = pop(rng(t, 12.0, 12.6))
    css(win, { left: cx + 'px', top: cy + 'px', opacity: clamp(kw * 3) * (1 - out), transform: `scale(${L(1.3, 1.6) * (0.6 + 0.4 * kw)})` })
    // he turns to camera after the win
    const kbub = pop(rng(t, 12.6, 13.2))
    css(bub, { left: px + s * L(0.2, 0.2) + 'px', top: py + s * L(0.27, 0.27) + 'px', opacity: clamp(kbub * 3) * (1 - out), transform: `scale(${kbub})` })
  }
})

// 4. room or phone: both views side by side, the real toggle flips between them on the beat
scene(14.4, 16.9, (root) => {
  const v = uiView(root, V ? 'm-desk' : 'desk')
  const head = words(root, L('Room or phone. <span class="dim">Your pick.</span>', 'Room or phone.<br><span class="dim">Your pick.</span>'), 'h1 abs')
  css(head, { fontSize: L(96, 104) + 'px', lineHeight: 1.04, textAlign: 'center' })
  const cards = [0, 1].map(() => {
    const c = el('div', 'abs', root)
    css(c, { pointerEvents: 'none', borderRadius: '34px', background: '#111', border: '1px solid rgba(255,255,255,.14)', overflow: 'hidden', boxShadow: '0 30px 90px rgba(0,0,0,.6)' })
    return c
  })
  const hero = clipImg('hero'); cards[0].appendChild(hero)
  const ph = clipImg('phone'); cards[1].appendChild(ph)
  const labels = ['his room', 'his phone'].map((s, i) => { const l = el('div', 'abs mono', cards[i], s); css(l, { left: '26px', top: '22px', fontSize: '24px', color: 'rgba(255,255,255,.7)', zIndex: 2 }); return l })
  const live = livePill(cards[1])
  let fixed = false
  return (t) => {
    if (!v.sr) return
    if (!fixed) {
      fixed = true
      const st = document.createElement('style')
      st.textContent = `:host { background: transparent !important; } .bar, .calls-dock, .strip, .stage, .mini-wrap, .fine, aside.panel { display: none !important; }`
      v.sr.appendChild(st)
    }
    const tg = box(v, 'views', '.views')
    const out = eIn(rng(t, 16.45, 16.9))
    playWords(head, t, 14.5, 0.09, 16.4)
    place(head, (W - head.offsetWidth) / 2, L(90, 200))
    // the two views
    const cw = L(830, 860), ch = L(600, 560), gap = L(36, 40)
    const y0 = L(250, 470)
    cards.forEach((c, i) => {
      const k = expoOut(rng(t, 14.5 + i * 0.12, 15.2 + i * 0.12))
      const x = V ? (W - cw) / 2 : W / 2 + (i ? gap / 2 : -gap / 2 - cw)
      const y = V ? y0 + i * (ch + gap) : y0
      place(c, x, y + (1 - k) * 60, cw, ch)
      // the view the toggle points at is lit
      const sel = Math.floor((t - 14.4) / 0.6) % 2 === 1 ? 1 : 0
      const on = (t < 15.0 ? 0 : sel) === i
      css(c, { opacity: clamp(k * 1.6) * (1 - out) * (on ? 1 : 0.5), borderColor: on ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.12)', transform: `scale(${on ? 1 : 0.97})`, transition: 'none' })
    })
    // inside each card
    const hs = ch * 2.0
    playClip(hero, t, 14.4 - 1.6)
    place(hero, (cw - hs) / 2, (ch - hs) / 2 - ch * 0.12, hs, hs)
    const ps = ch * 1.75
    playClip(ph, t, 14.4, { loop: true })
    place(ph, cw * 0.5 - ps * 0.47, ch * 0.5 - ps * 0.55, ps, ps)
    css(live, { left: cw - 170 + 'px', top: '16px', transform: 'scale(.8)', transformOrigin: '100% 0' })
    pulse(live, t)
    void labels
    // the real toggle under them, flipping on the beat
    const sel = t < 15.0 ? 0 : Math.floor((t - 14.4) / 0.6) % 2
    $$(v, '.views button').forEach((e, i) => { e.classList.toggle('on', i === sel); e.setAttribute('aria-pressed', String(i === sel)) })
    const sc = L(2.6, 2.9)
    const ty = V ? y0 + 2 * ch + gap + 130 : y0 + ch + 100
    camera(v, t, [[0, tg.x + tg.w / 2, tg.y + tg.h / 2 - (ty - H / 2) / sc, sc]])
    const kt = pop(rng(t, 14.75, 15.35))
    css(v.wrap, { opacity: clamp(kt * 3) * (1 - out) })
    const vw = $(v, '.views')
    if (vw) css(vw, { transform: `scale(${0.6 + 0.4 * kt})` })
  }
})

// 5. end card: logo, feature line, url
scene(16.8, DURATION, (root) => {
  const hero = clipImg('hero'); root.appendChild(hero)
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(130, 130) + 'px' })
  const line = words(root, 'Watch him trade, <span class="hl-gain">live.</span>', 'sub abs')
  css(line, { fontSize: L(50, 54) + 'px', color: 'rgba(255,255,255,.8)' })
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  css(url, { fontSize: L(26, 32) + 'px' })
  const live = livePill(root, 'on the home page')
  return (t) => {
    const hs = L(1100, 1300)
    playClip(hero, t, 16.8)
    place(hero, (W - hs) / 2, L(H * 0.58, H * 0.53) - hs / 2, hs, hs)
    css(hero, { opacity: 1 })
    const ms = 112
    const kw = pop(rng(t, 17.35, 18.1))
    const rowW = ms + 24 + (word.offsetWidth || 500)
    const y = L(70, 260)
    place(mark, (W - rowW) / 2, y + 8, ms, ms)
    const blink = t > 19.6 && t < 19.76 ? 0.12 : 1
    const lk = eInOut(rng(t, 18.6, 19.0))
    mark.innerHTML = markSVG('house', 'sphere', lerp(0.45, -0.05, lk), lerp(-0.35, 0.05, lk), blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, 17.45, 0)
    place(word, (W - rowW) / 2 + ms + 24, y)
    playWords(line, t, 17.9, 0.08)
    place(line, (W - line.offsetWidth) / 2, y + L(170, 180))
    const ku = expoOut(rng(t, 18.5, 19.1))
    place(url, (W - url.offsetWidth) / 2, L(H - 140, H - 300))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
    const kl = pop(rng(t, 18.2, 18.8))
    place(live, (W - live.offsetWidth) / 2, L(H - 235, H - 420))
    css(live, { opacity: clamp(kl * 3), transform: `scale(${L(1, 1.25) * (0.5 + 0.5 * kl)})` })
    pulse(live, t)
  }
})
