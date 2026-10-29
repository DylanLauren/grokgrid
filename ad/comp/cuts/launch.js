// Feature video: "Launch your own Grok Bot". The real Grid page: connect once, hover a few colours (their real hover
// animations), pick blue, name it (ticker fills itself), describe it, socials, one approval launches its coin; then
// the launch moment, the 80/20 creator fee split and the end card. 98 bpm: one bar is 2.449 s, cuts land on bars.
const DURATION = 23
const BARS = (n) => n * (60 / 98) * 4
const T_UI = BARS(1), T_LIVE = BARS(6), T_FEES = BARS(7), T_END = BARS(8)

// the bot this video launches
const BOT = { name: 'full send', pick: 5, color: '#1683ff', shape: 'squircle' }
const TICK = BOT.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
const DESC = 'a grok bot that sends it on pump.fun, inside its fixed limits.'
const XURL = 'https://x.com/fullsendbot'

// the drawn cursor must not catch the real mouse, or the redrawn UI never sees its hover
css(cursor, { pointerEvents: 'none' }); css(ripple, { pointerEvents: 'none' })

// a big kinetic caption over the coded UI: bottom band in 16:9, top band in 9:16
function caption(root) {
  const scrim = el('div', 'abs', root)
  scrim.style.pointerEvents = 'none'
  if (V) css(scrim, { left: 0, right: 0, top: 0, height: '520px', background: 'linear-gradient(rgba(10,10,10,.96) 62%, rgba(10,10,10,0))' })
  else css(scrim, { left: 0, right: 0, bottom: 0, height: '330px', background: 'linear-gradient(rgba(10,10,10,0), rgba(10,10,10,.94) 50%)' })
  return scrim
}
function placeCap(c) {
  if (V) place(c, (W - c.offsetWidth) / 2, 150 - (c.offsetHeight > 150 ? 50 : 0))
  else place(c, 96, H - 70 - c.offsetHeight)
}

// 1. hook: the family runs in under "Launch your own Grok Bot."
scene(0, T_UI, (root) => {
  const run = clipImg('family_run'); root.appendChild(run)
  const a = words(root, L('Launch your own', 'Launch<br>your own'), 'h1 abs')
  css(a, { fontSize: L(150, 150) + 'px', textAlign: 'center' })
  const b = words(root, '<span class="hl-blue">Grok Bot.</span>', 'h1 abs')
  css(b, { fontSize: L(150, 170) + 'px' })
  const rw = L(W * 1.05, W * 2.0)
  return (t) => {
    playWords(a, t, 0.08, 0.1, 2.2)
    playWords(b, t, 0.75, 0, 2.2)
    const ka = expoOut(rng(t, 0.75, 1.3))
    if (V) {
      place(a, (W - a.offsetWidth) / 2, 380)
      place(b, (W - b.offsetWidth) / 2, 720)
    } else {
      place(a, (W - a.offsetWidth) / 2, 150 - ka * 20)
      place(b, (W - b.offsetWidth) / 2, 310 - ka * 10)
    }
    playClip(run, t, -0.6)
    const rh = rw * 900 / 1600
    place(run, (W - rw) / 2, L(H * 0.7 - rh * 0.5, H * 0.72 - rh * 0.5), rw, rh)
    css(run, { opacity: rng(t, 0, 0.1) * (1 - rng(t, 2.15, 2.4)), transform: `scale(${1 + eIn(rng(t, 2.0, 2.45)) * 0.15})` })
  }
})

// 2-4. the real Grid page, one camera move after another: connect, hover and pick, name and describe, launch
scene(T_UI, T_LIVE, (root) => {
  const v = uiView(root, V ? 'm-grid' : 'grid')
  const scrim = caption(root)
  const c1 = words(root, 'Connect once.', 'h1 abs')
  const c2 = words(root, L('Pick your <span class="hl-blue">bot.</span>', 'Pick your<br><span class="hl-blue">bot.</span>'), 'h1 abs')
  const c3 = words(root, L('Name it. <span class="dim">The ticker fills itself.</span>', 'Name it.<br><span class="dim">Ticker fills itself.</span>'), 'h1 abs')
  const c4 = words(root, L('One approval. <span class="hl-gain">Launched.</span>', 'One approval.<br><span class="hl-gain">Launched.</span>'), 'h1 abs')
  for (const c of [c1, c2, c3, c4]) css(c, { pointerEvents: 'none', fontSize: L(88, 104) + 'px', textAlign: 'center', lineHeight: 1.04 })
  let prepped = false, picked = false, connected = false, launched = false
  const prep = () => {
    // the page as it is once launches are open: a Connect step, a Launch button, no paused note
    const sub = $(v, '.pg-sub')
    if (sub) sub.textContent = 'one agent per wallet, with its own coin on pump.fun. connect phantom and sign in once. one approval launches the coin and funds your bot’s own trading wallet.'
    const con = $(v, '.gd-connect')
    if (con) con.innerHTML = `<div class="gd-connect-row"><div><h2>Connect Phantom</h2><p>sign in once. your bot gets its own trading wallet.</p></div><button class="btn" type="button">Connect</button></div>`
    const btn = $(v, 'button[type=submit]')
    if (btn) { btn.removeAttribute('disabled'); btn.innerHTML = 'Launch' }
    const notes = $$(v, '.gd-form .gd-note')
    const last = notes[notes.length - 1]
    if (last) { last.className = 'gd-note launch-slot'; last.innerHTML = '' }
    const st = document.createElement('style')
    st.textContent = `.gd-split div { transition: none; } .launch-slot { display: grid; gap: 10px; } .gd-connect h2 { display: flex; align-items: center; gap: 10px; }`
    v.sr.appendChild(st)
  }
  const setField = (sel, val, max) => {
    const e = $(v, sel)
    if (!e) return
    e.value = val
    if (e.tagName === 'INPUT') e.setAttribute('value', val)
    const i = e.closest('.gd-field')?.querySelector('.gd-label i')
    if (i && max) i.textContent = `${val.length}/${max}`
  }
  // camera keys are [t, x, y, scale] on the point that should sit in the middle of the free frame (above or below the caption)
  const OFF = L(-120, 230)
  const cam = (t, keys) => camera(v, t, keys.map(([k, x, y, s]) => [k, x, y - OFF / s, s]))
  return (t) => {
    // end.js lays its fade-to-black over the whole stage; it must let the mouse through as well
    if (typeof fade !== 'undefined') fade.style.pointerEvents = 'none'
    if (!v.sr) return
    if (!prepped) { prep(); prepped = true }
    const con = box(v, 'con', '.gd-connect'), cbtn = box(v, 'cbtn', '.gd-connect .btn'), line = box(v, 'line', '.gd-line')
    const picks = [1, 4, 6, BOT.pick].map((i) => box(v, 'p' + i, '.gd-pick', i))
    const prev = box(v, 'prev', '.gd-preview'), coin = box(v, 'coin', '.gd-coin'), name = box(v, 'name', 'input[placeholder="night shift"]')
    const desc = box(v, 'desc', 'textarea'), x = box(v, 'x', 'input[placeholder="https://x.com/yourbot"]')
    const split = box(v, 'split', '.gd-split'), go = box(v, 'go', 'button[type=submit]'), l4 = box(v, 'l4', '.gd-group legend', 3)
    const title = box(v, 'title', '.pg-title')
    const ly = line.y + line.h / 2
    // timeline (seconds)
    const tC = T_UI + 0.85, tH = [T_UI + 1.3, T_UI + 2.15, T_UI + 3.0, T_UI + 3.85], tP = T_UI + 4.3
    const tName = BARS(3) + 0.55, tDesc = BARS(3) + 1.45, tX = BARS(4) + 1.5
    const tGo = BARS(5) + 0.95
    if (V) cam(t, [[T_UI, 215, title.y + 140, 2.2], [tC - 0.3, 215, con.y + con.h / 2 + 30, 2.45], [tC + 0.25, 215, con.y + con.h / 2 + 30, 2.45], [tH[0], 215, ly - 10, 2.45], [tP + 0.5, 215, ly, 2.5],
      [BARS(3) + 0.1, 215, prev.y + prev.h / 2 + 80, 2.25], [tName - 0.05, 215, (coin.y + desc.y + desc.h) / 2, 2.0], [tX - 0.2, 215, (coin.y + desc.y + desc.h) / 2 + 10, 2.0], [tX + 0.25, 215, (coin.y + x.y + x.h) / 2 + 6, 1.95], [BARS(5) - 0.1, 215, (coin.y + x.y + x.h) / 2 + 10, 1.95],
      [BARS(5) + 0.6, 215, go.y - 80, 2.25], [T_LIVE, 215, go.y - 50, 2.3]])
    else cam(t, [[T_UI, 800, title.y + 230, 1.22], [tC - 0.3, 800, (con.y + ly) / 2, 1.38], [tC + 0.25, 800, (con.y + ly) / 2, 1.38], [tH[0], 800, ly - 10, 1.55], [tP + 0.5, 800, ly, 1.58],
      [BARS(3) + 0.1, 790, (prev.y + 70 + x.y + x.h) / 2, 1.6], [BARS(5) - 0.1, 790, (prev.y + 70 + x.y + x.h) / 2 + 8, 1.64],
      [BARS(5) + 0.6, go.x + go.w / 2, (split.y + go.y + 150) / 2, 1.85], [T_LIVE, go.x + go.w / 2, (split.y + go.y + 150) / 2 + 20, 1.9]])
    const kin = expoOut(rng(t, T_UI, T_UI + 0.6))
    css(v.wrap, { opacity: clamp(kin * 2), transform: `scale(${1.06 - 0.06 * kin})` })
    pageIn(v, t, T_UI + 0.02)
    // the connect card, then the picker bots pop in left to right
    cascade([$(v, '.gd-connect')].filter(Boolean), t, T_UI + 0.2, 0, 30)
    $$(v, '.gd-pick').forEach((e, i) => { const p = pop(rng(t, T_UI + 0.35 + i * 0.05, T_UI + 0.95 + i * 0.05)); e.style.transform = `scale(${0.4 + 0.6 * p})`; e.style.opacity = clamp(p * 2) })
    // connect: one click, signed in
    if (t >= tC && !connected) {
      connected = true
      const c = $(v, '.gd-connect')
      if (c) c.innerHTML = `<div class="gd-connect-row"><div><h2><span class="gd-dot"></span>Phantom connected</h2><p class="mono">7Gk2…q9Wd · signed in</p></div><button class="btn ghost" type="button">Connected</button></div>`
    }
    // pick blue: the preview bot and the coin picture turn blue
    if (t >= tP && !picked) {
      picked = true
      $$(v, '.gd-pick').forEach((e, i) => { e.classList.toggle('on', i === BOT.pick); e.setAttribute('aria-checked', String(i === BOT.pick)) })
      const from = $$(v, '.gd-pick')[BOT.pick].querySelector('.lb'), to = $(v, '.gd-side .lb')
      if (from && to) { const c = from.cloneNode(true); c.style.cssText = to.style.cssText; c.setAttribute('class', 'lb lb-flip sel'); to.replaceWith(c) }
      const sv = $$(v, '.gd-pick')[BOT.pick].querySelector('svg')
      if (sv) {
        const art = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -14 128 128"><rect x="-14" y="-14" width="128" height="128" fill="#f2f3f5"/>${sv.innerHTML}</svg>`
        $$(v, 'img[src^="data:image/svg"]').forEach((im) => { im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art) })
      }
    }
    // typing: the field, its counter, the preview, the coin card; the ticker fills itself
    const n = clamp(Math.floor((t - tName) / 0.07), 0, BOT.name.length)
    const typed = BOT.name.slice(0, n), tk = typed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
    setField('input[placeholder="night shift"]', typed, 32)
    setField('input[placeholder="NIGHT"]', tk, 10)
    const nd = clamp(Math.floor((t - tDesc) / 0.026), 0, DESC.length), dtyped = DESC.slice(0, nd)
    setField('textarea', dtyped, 600)
    const nx = clamp(Math.floor((t - tX) / 0.03), 0, XURL.length)
    setField('input[placeholder="https://x.com/yourbot"]', XURL.slice(0, nx))
    const pv = $(v, '.gd-preview b'); if (pv) pv.textContent = typed || 'your bot'
    const cn = $(v, '.gd-coin-top b'); if (cn) cn.textContent = typed || 'coin name'
    const ct = $(v, '.gd-coin-top span'); if (ct) ct.textContent = '$' + (tk || 'TICKER')
    const cp = $(v, '.gd-coin p'); if (cp) cp.textContent = dtyped || 'what the coin is about.'
    const links = $(v, '.gd-links')
    if (links) {
      const want = nx >= XURL.length
      const has = links.querySelector('.x-chip')
      if (want && !has) { const s = document.createElement('span'); s.className = 'x-chip'; s.textContent = 'x'; links.insertBefore(s, links.children[1]) }
      if (has) css(has, { opacity: eOut(rng(t, tX + XURL.length * 0.03, tX + XURL.length * 0.03 + 0.3)) })
    }
    const focusOn = t < tDesc - 0.15 ? 'input[placeholder="night shift"]' : t < tX - 0.15 ? 'textarea' : 'input[placeholder="https://x.com/yourbot"]'
    const fe = $(v, focusOn)
    if (fe && t > tName - 0.1 && t < BARS(5)) fe.focus()
    else if (t >= BARS(5) && v.sr.activeElement) v.sr.activeElement.blur()
    // the coin card answers each keystroke with a small lift
    const lastKey = Math.max(tName + n * 0.07, tDesc + nd * 0.026)
    const ck = $(v, '.gd-coin')
    if (ck) css(ck, { borderColor: t > tName && t < BARS(5) ? `rgba(22,131,255,${0.35 + 0.35 * (1 - rng(t, lastKey, lastKey + 0.3))})` : '' })
    // the 80/20 split lights up as the camera passes, then Launch
    $$(v, '.gd-split div').forEach((e, i) => {
      const k = eOut(rng(t, BARS(5) + 0.35 + i * 0.18, BARS(5) + 0.75 + i * 0.18))
      css(e, { borderColor: k ? `rgba(${i ? '255,106,0' : '22,131,255'},${0.2 + 0.6 * k})` : '', background: k ? `rgba(${i ? '255,106,0' : '22,131,255'},${0.08 * k})` : '' })
    })
    const slot = $(v, '.launch-slot')
    if (t >= tGo && !launched && slot) {
      launched = true
      slot.innerHTML = `<ol class="gd-steps"><li>approve once in phantom</li><li>launch $${TICK} on pump.fun</li><li>fund its trading wallet</li></ol><p class="gd-made">${BOT.name} is live on pump.fun.</p>`
    }
    if (slot && launched) {
      $$(v, '.gd-steps li').forEach((li, i) => {
        const a = tGo + 0.12 + i * 0.36
        li.className = t >= a + 0.36 ? 'done' : t >= a ? 'on' : ''
      })
      const made = slot.querySelector('.gd-made')
      const km = expoOut(rng(t, tGo + 1.3, tGo + 1.7))
      if (made) css(made, { opacity: km, transform: `translateY(${(1 - km) * 10}px)` })
    }
    const b = $(v, 'button[type=submit]')
    if (b) b.style.transform = t >= tGo - 0.06 && t < tGo + 0.14 ? 'scale(.97)' : ''
    // the cursor: Connect, then hover orange, violet and pink (each plays its own move), click blue, then Launch
    const [bx, by] = centre(v, cbtn, 0.5, 0.55)
    const hp = picks.map((p) => centre(v, p, 0.5, 0.45))
    const [gx, gy] = centre(v, go, 0.42, 0.5)
    CURSOR = [[[T_UI + 0.45, bx + L(220, 120), by + L(200, 260)], [tC - 0.05, bx, by], [tC + 0.25, bx + 4, by + 2],
      [tH[0] - 0.05, ...hp[0]], [tH[0] + 0.7, hp[0][0] + 6, hp[0][1] + 4], [tH[1] - 0.05, ...hp[1]], [tH[1] + 0.7, hp[1][0] + 6, hp[1][1] + 4],
      [tH[2] - 0.05, ...hp[2]], [tH[2] + 0.7, hp[2][0] + 6, hp[2][1] + 4], [tH[3] - 0.05, ...hp[3]], [tP + 0.5, hp[3][0] + 4, hp[3][1] + 4],
      [BARS(5) + 0.55, gx + L(160, 120), gy - L(120, 160)], [tGo - 0.05, gx, gy], [tGo + 1.6, gx + 10, gy + 6]], [tC, tP, tGo]]
    // the cursor leaves the picker while the camera travels to the form
    if (t > tP + 0.55 && t < BARS(5) + 0.1) CURSOR = null
    // captions
    playWords(c1, t, T_UI + 0.15, 0.08, tH[0] - 0.35)
    playWords(c2, t, tH[0] - 0.05, 0.1, BARS(3) - 0.25)
    playWords(c3, t, BARS(3) + 0.1, 0.08, BARS(5) - 0.25)
    playWords(c4, t, BARS(5) + 0.1, 0.12, T_LIVE + 1)
    for (const c of [c1, c2, c3, c4]) placeCap(c)
    css(scrim, { opacity: kin })
  }
})

// 5. the launch moment: its coin flips in, rings go out, the family bursts around it
scene(T_LIVE, T_FEES, (root) => {
  const flash = el('div', 'flash', root)
  const rings = [0, 1, 2].map(() => el('div', 'abs', root))
  rings.forEach((r) => css(r, { borderRadius: '50%', border: '3px solid ' + BOT.color }))
  const coin = el('div', 'abs', root)
  css(coin, { borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, #5aa9ff, ${BOT.color} 55%, #0b4fa6)`, boxShadow: '0 0 0 10px rgba(22,131,255,.25), 0 40px 120px rgba(22,131,255,.35), inset 0 -10px 30px rgba(0,0,0,.25)', display: 'grid', placeItems: 'center' })
  const face = el('div', 'abs', coin)
  css(face, { inset: '18%', borderRadius: '50%', background: '#f2f3f5', display: 'grid', placeItems: 'center' })
  const mk = el('div', '', face, markSVG(BOT.color, BOT.shape))
  css(mk, { width: '74%', height: '74%' })
  const bits = FAMILY.concat(FAMILY).map(([c, s], i) => { const m = el('div', 'mark', root, markSVG(c, s, Math.cos(i * 2) * 0.5, Math.sin(i) * 0.4)); m._i = i; return m })
  const live = el('div', 'chip', root, `<span style="width:14px;height:14px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 6px rgba(74,222,128,.18)"></span><div class="t1 mono" style="font-size:22px;letter-spacing:.08em">LIVE ON PUMP.FUN</div>`)
  css(live, { padding: '14px 24px' })
  const head = words(root, `<span class="hl-blue">$${TICK}</span><br>is live.`, 'h1 abs')
  css(head, { fontSize: L(132, 128) + 'px', textAlign: L('left', 'center') })
  const sub = words(root, 'its own coin. its own wallet. trading.', 'sub abs')
  css(sub, { fontSize: L(40, 42) + 'px' })
  return (t) => {
    const T = T_LIVE, out = eIn(rng(t, T_FEES - 0.35, T_FEES))
    css(flash, { opacity: 0.85 * (1 - eOut(rng(t, T, T + 0.35))) })
    const cs = L(460, 520)
    const cx = L(W * 0.3, W / 2), cy = L(H / 2, H * 0.36)
    // the coin flips in on its edge, overshoots and settles, then keeps a slow spin
    const k = backOut(rng(t, T + 0.02, T + 0.7), 1.3)
    const spin = Math.cos((1 - eOut(rng(t, T, T + 0.9))) * Math.PI * 3)
    const breath = 1 + 0.015 * Math.sin((t - T) * 5)
    place(coin, cx - cs / 2, cy - cs / 2, cs, cs)
    css(coin, { transform: `scale(${k * breath * (1 - out * 0.2)}) scaleX(${Math.abs(spin) < 0.06 ? 0.06 : spin}) rotate(${(1 - k) * -25}deg)`, opacity: clamp(k * 3) * (1 - out) })
    mk.innerHTML = markSVG(BOT.color, BOT.shape, 0.4 * Math.sin((t - T) * 2), -0.1, t > T + 1.6 && t < T + 1.75 ? 0.12 : 1)
    rings.forEach((r, i) => {
      const a = rng(t, T + 0.25 + i * 0.22, T + 1.25 + i * 0.22)
      const s = cs * (1 + eOut(a) * L(1.6, 1.3))
      place(r, cx - s / 2, cy - s / 2, s, s)
      css(r, { opacity: a > 0 && a < 1 ? (1 - a) * 0.8 : 0, borderWidth: 2 + 6 * (1 - a) + 'px' })
    })
    // nine colours twice over, thrown out of the coin and drifting
    bits.forEach((m) => {
      const i = m._i
      const ang = i * 2.39996 + 0.4
      const a = rng(t, T + 0.3 + (i % 9) * 0.02, T + 1.4 + (i % 9) * 0.02)
      const d = cs * (0.62 + (i % 4) * 0.16 + (i >= 9 ? 0.32 : 0)) * expoOut(a)
      const sz = L(70, 76) * (i >= 9 ? 0.72 : 1)
      const drift = (t - T) * 14
      place(m, cx + Math.cos(ang) * (d + drift) * L(1.25, 1) - sz / 2, cy + Math.sin(ang) * (d + drift) * L(0.85, 1) - sz / 2, sz, sz)
      css(m, { opacity: clamp(a * 4) * (1 - out) * (V ? (Math.sin(ang) > 0.35 ? 0.25 : 1) : Math.cos(ang) < 0.55 ? 1 : 0.25), transform: `scale(${pop(a)}) rotate(${Math.sin(t * 2 + i) * 14 + (1 - a) * 180}deg)` })
    })
    playWords(head, t, T + 0.45, 0.12, T_FEES - 0.35)
    playWords(sub, t, T + 0.85, 0.06, T_FEES - 0.35)
    const kl = pop(rng(t, T + 1.1, T + 1.7))
    if (V) {
      place(head, (W - head.offsetWidth) / 2, H * 0.6)
      place(sub, (W - sub.offsetWidth) / 2, H * 0.6 + head.offsetHeight + 30)
      place(live, (W - live.offsetWidth) / 2, H * 0.6 + head.offsetHeight + 130)
    } else {
      place(head, W * 0.5, H / 2 - 230)
      place(sub, W * 0.5 + 6, H / 2 + 60)
      place(live, W * 0.5, H / 2 + 140)
    }
    css(live, { opacity: clamp(kl * 3) * (1 - out), transform: `scale(${0.6 + 0.4 * kl})` })
    const dot = live.firstChild
    css(dot, { boxShadow: `0 0 0 ${4 + 6 * ((t * 1.6) % 1)}px rgba(74,222,128,${0.3 * (1 - ((t * 1.6) % 1))})` })
  }
})

// 6. where its creator fees go: 80% to its trading wallet, 20% buys and burns $GRID
scene(T_FEES, T_END, (root) => {
  const head = words(root, L('Its fees keep it <span class="hl-blue">trading.</span>', 'Its fees keep it<br><span class="hl-blue">trading.</span>'), 'h1 abs')
  css(head, { fontSize: L(100, 112) + 'px', textAlign: 'center' })
  const coin = el('div', 'coin', root, `<div style="width:52px;height:52px;border-radius:50%;background:#f2f3f5;display:grid;place-items:center"><div style="width:40px;height:40px">${markSVG(BOT.color, BOT.shape)}</div></div>$${TICK} <span class="mono dim" style="font-size:20px">creator fees</span>`)
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg'); root.appendChild(svg)
  svg.setAttribute('width', W); svg.setAttribute('height', H)
  css(svg, { position: 'absolute', left: 0, top: 0, overflow: 'visible' })
  const paths = [0, 1].map((i) => { const p = document.createElementNS(svgNS, 'path'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', i ? '#ff6a00' : BOT.color); p.setAttribute('stroke-width', i ? 4 : 8); p.setAttribute('stroke-linecap', 'round'); svg.appendChild(p); return p })
  const dots = []
  for (let i = 0; i < 14; i++) { const c = document.createElementNS(svgNS, 'circle'); c.setAttribute('r', i % 7 < 5 ? 7 : 5); c.setAttribute('fill', i % 7 < 5 ? '#7fb8ff' : '#ffb27a'); svg.appendChild(c); dots.push(c) }
  const card = (pct, label, ic) => {
    const c = el('div', 'abs', root)
    css(c, { width: L(560, 660) + 'px', padding: '30px 34px', borderRadius: '28px', background: '#141414', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 30px 90px rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', gap: '26px' })
    c.innerHTML = `<div style="width:96px;height:96px;flex:0 0 auto">${ic}</div><div><div class="pct" style="font:600 92px Geist;letter-spacing:-.05em;line-height:1">${pct}</div><div style="font:500 30px Geist;color:rgba(255,255,255,.7);letter-spacing:-.02em;margin-top:8px;white-space:nowrap">${label}</div></div>`
    return c
  }
  const flame = `<svg viewBox="0 0 40 52" width="100%" height="100%"><path d="M20 2c4 10 16 16 16 30a16 16 0 0 1-32 0c0-8 5-12 8-17c1 5 3 7 5 8c0-8-1-14 3-21z" fill="#ff6a00"/><path d="M20 22c3 6 9 9 9 16a9 9 0 0 1-18 0c0-4 3-7 5-10c1 3 2 4 3 4c0-4 0-7 1-10z" fill="#ffb27a"/></svg>`
  const a = card('80%', 'to its trading wallet', markSVG(BOT.color, BOT.shape))
  const b = card('20%', 'buys and burns <b style="color:#ff6a00">$GRID</b>', flame)
  const note = el('div', 'abs mono dim', root, '80/20 split locked at creation')
  css(note, { fontSize: '22px' })
  return (t) => {
    const T = T_FEES, out = eIn(rng(t, T_END - 0.3, T_END))
    playWords(head, t, T + 0.05, 0.09, T_END - 0.3)
    place(head, (W - head.offsetWidth) / 2, L(90, 330))
    const kc = pop(rng(t, T + 0.15, T + 0.75))
    const cy = L(330, 680)
    css(coin, { left: (W - coin.offsetWidth) / 2 + 'px', top: cy + 'px', opacity: clamp(kc * 3) * (1 - out), transform: `scale(${kc})` })
    // two streams leave the coin; the thick one feeds the bot, the thin one the burn
    const sx = W / 2, sy = cy + 78
    const aw = a.offsetWidth, ah = a.offsetHeight
    const ax = L(W / 2 - aw - 40, 70), ay = L(640, 1000)
    const bx = L(W / 2 + 40, W - 70 - aw), by = L(640, 1330)
    let pa, pb
    if (V) {
      pa = `M${sx} ${sy} C ${sx} ${sy + 120}, ${ax + aw * 0.45} ${ay - 160}, ${ax + aw * 0.45} ${ay}`
      pb = `M${sx} ${sy} C ${sx} ${sy + 160}, ${bx + aw * 0.86} ${ay - 200}, ${bx + aw * 0.86} ${by}`
    } else {
      pa = `M${sx} ${sy} C ${sx} ${sy + 150}, ${ax + aw / 2} ${ay - 150}, ${ax + aw / 2} ${ay}`
      pb = `M${sx} ${sy} C ${sx} ${sy + 150}, ${bx + aw / 2} ${by - 150}, ${bx + aw / 2} ${by}`
    }
    paths[0].setAttribute('d', pa); paths[1].setAttribute('d', pb)
    paths.forEach((p, i) => {
      const len = p.getTotalLength()
      const k = eInOut(rng(t, T + 0.5 + i * 0.15, T + 1.0 + i * 0.15))
      p.setAttribute('stroke-dasharray', `${len} ${len}`)
      p.setAttribute('stroke-dashoffset', String(len * (1 - k)))
      p.setAttribute('opacity', String(0.75 * (1 - out)))
    })
    dots.forEach((d, i) => {
      const p = paths[i % 7 < 5 ? 0 : 1]
      const len = p.getTotalLength()
      const ph = ((t - T - 0.9) * 0.9 + (i % 7) / 7) % 1
      const on = t > T + 0.95 && ph >= 0
      const pt = p.getPointAtLength(len * Math.max(0, ph))
      d.setAttribute('cx', pt.x); d.setAttribute('cy', pt.y)
      d.setAttribute('opacity', on ? String((1 - out) * Math.sin(ph * Math.PI)) : '0')
    })
    const ka = pop(rng(t, T + 0.85, T + 1.45)), kb = pop(rng(t, T + 1.05, T + 1.65))
    place(a, ax, ay); place(b, bx, by)
    css(a, { opacity: clamp(ka * 3) * (1 - out), transform: `scale(${0.7 + 0.3 * ka})`, borderColor: 'rgba(22,131,255,.6)' })
    css(b, { opacity: clamp(kb * 3) * (1 - out), transform: `scale(${0.7 + 0.3 * kb})`, borderColor: 'rgba(255,106,0,.55)' })
    a.querySelector('.pct').textContent = Math.round(80 * eOut(rng(t, T + 0.9, T + 1.6))) + '%'
    b.querySelector('.pct').textContent = Math.round(20 * eOut(rng(t, T + 1.1, T + 1.8))) + '%'
    // the bot bounces as fees land; the flame flickers
    const ic = a.firstChild, fl = b.firstChild
    ic.innerHTML = markSVG(BOT.color, BOT.shape, 0.3, -0.2, t > T + 1.9 && t < T + 2.02 ? 0.12 : 1)
    css(ic, { transform: `translateY(${-Math.abs(Math.sin((t - T) * 6)) * 8 * rng(t, T + 1.2, T + 1.4)}px)` })
    css(fl, { transform: `scale(${1 + 0.05 * Math.sin(t * 19)}, ${1 + 0.1 * Math.sin(t * 23 + 1)})`, transformOrigin: '50% 100%' })
    place(note, (W - note.offsetWidth) / 2, L(H - 120, by + b.offsetHeight + 60))
    css(note, { opacity: rng(t, T + 1.6, T + 1.9) * (1 - out) })
  }
})

// 7. end card: the family hops in a row, the house bot, GrokGrid, the feature line, the url
scene(T_END, DURATION, (root) => {
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(140, 140) + 'px' })
  const line = words(root, L('Launch your own <span class="hl-blue">Grok Bot.</span>', 'Launch your own<br><span class="hl-blue">Grok Bot.</span>'), 'h1 abs')
  css(line, { fontSize: L(72, 84) + 'px', textAlign: 'center', color: 'rgba(255,255,255,.92)' })
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  const row = FAMILY.map(([c, s], i) => el('div', 'mark', root, markSVG(c, s, Math.sin(i) * 0.5, -0.2)))
  return (t) => {
    const T = T_END
    const ms = L(130, 150)
    const kw = pop(rng(t, T + 0.05, T + 0.8))
    const rowW = ms + 26 + (word.offsetWidth || 560)
    const y = L(250, 620)
    place(mark, (W - rowW) / 2, y + L(4, 0), ms, ms)
    const blink = t > T + 1.5 && t < T + 1.66 ? 0.12 : 1
    mark.innerHTML = markSVG('house', 'sphere', 0.45 - 0.5 * eInOut(rng(t, T + 0.7, T + 1.1)), -0.35 + 0.3 * eInOut(rng(t, T + 0.7, T + 1.1)), blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, T + 0.1, 0)
    place(word, (W - rowW) / 2 + ms + 26, y)
    playWords(line, t, T + 0.4, 0.08)
    place(line, (W - line.offsetWidth) / 2, y + L(200, 230))
    const ku = expoOut(rng(t, T + 0.8, T + 1.4))
    place(url, (W - url.offsetWidth) / 2, L(y + 330, y + 500))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
    // the nine colours line up along the bottom and hop in a wave
    const sz = L(96, 92), gap = L(30, 14)
    const rw = 9 * sz + 8 * gap
    row.forEach((m, i) => {
      const k = pop(rng(t, T + 0.3 + i * 0.05, T + 0.9 + i * 0.05))
      const hop = Math.max(0, Math.sin((t - T) * 5 - i * 0.6)) * 18 * rng(t, T + 1, T + 1.3)
      place(m, (W - rw) / 2 + i * (sz + gap), L(H - 230, H - 560) - hop, sz, sz)
      css(m, { opacity: clamp(k * 3), transform: `scale(${k})` })
    })
  }
})
