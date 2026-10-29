// Feature video: the matrix. One live table of every token Grok Bot trades and every Grok Bot users launch.
// 110 bpm: one bar = 2.1818 s. Cuts land on bar lines: 0, 2.18, 6.55 (sort), 10.91 (glide), 15.27, 17.45 (end card).
const DURATION = 22.3
const MB = 60 / 110 * 4 // one bar
const B1 = MB, B3 = 3 * MB, B5 = 5 * MB, B6 = 6 * MB, B7 = 7 * MB, B8 = 8 * MB

// coin tiles drawn like the site's token pictures (rounded square, colour, mono letter)
const COINS = [['#0b0b0b', 'F'], ['#ff6a00', 'P'], ['#ff9a00', 'G'], ['#13b8a6', 'C'], ['#9a6a3f', 'D'], ['#1683ff', 'C'], ['#7a7a7a', 'R'], ['#9b5cff', 'S'], ['#ff2e9a', 'R']]
const coinHTML = (c, l) => `<div style="width:100%;height:100%;border-radius:24%;background:${c};display:grid;place-items:center;font:600 34px 'Geist Mono';color:${c === '#0b0b0b' ? '#f2f2f2' : '#0a0a0a'};box-shadow:inset 0 0 0 2px rgba(255,255,255,.14)">${l}</div>`

// 1. hook: a wall of bots and their coins, checkerboard, "Every bot. Every token."
scene(0, B1 + 0.05, (root) => {
  const cols = L(15, 8), rows = L(8, 15)
  const size = L(96, 100), gap = L(22, 26)
  const wall = el('div', 'marks', root); wall.style.pointerEvents = 'none'
  const tiles = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = (r * 5 + c * 4 + ((r * c) % 3)) % FAMILY.length
    const coin = (r + c) % 2 === 1
    const m = el('div', 'mark', wall, coin ? coinHTML(...COINS[i]) : markSVG(FAMILY[i][0], FAMILY[i][1], Math.sin(r * 1.7 + c) * 0.6, Math.cos(c * 1.3 + r) * 0.4))
    m._rc = [r, c]; m._coin = coin; m._i = i
    tiles.push(m)
  }
  const veil = el('div', 'abs', root)
  css(veil, { pointerEvents: 'none', inset: 0, background: `radial-gradient(${L('46% 30%', '48% 22%')} at 50% 50%, rgba(10,10,10,.97) 42%, rgba(10,10,10,.6) 76%, rgba(10,10,10,0))` })
  const head = words(root, 'Every bot.<br><span class="dim">Every token.</span>', 'h1 abs')
  css(head, { fontSize: L(140, 140) + 'px', textAlign: 'center' })
  return (t) => {
    const gw = cols * size + (cols - 1) * gap, gh = rows * size + (rows - 1) * gap
    const x0 = (W - gw) / 2, y0 = (H - gh) / 2
    // the wall rushes at the camera into the cut
    const go = eIn(rng(t, 1.8, B1), 2)
    css(wall, { left: 0, top: 0, width: W + 'px', height: H + 'px', transform: `scale(${1 + go * 1.4})`, transformOrigin: '50% 50%', opacity: 1 - go })
    tiles.forEach((m) => {
      const [r, c] = m._rc
      const d = Math.hypot(r - (rows - 1) / 2, (c - (cols - 1) / 2) * L(0.6, 1)) * 0.045
      const k = pop(rng(t, 0.02 + d, 0.6 + d))
      const bob = Math.sin(t * 4 + r * 0.9 + c * 0.7) * 3
      place(m, x0 + c * (size + gap), y0 + r * (size + gap) + bob, size, size)
      css(m, { opacity: clamp(k * 3), transform: `scale(${k}) rotate(${(1 - k) * (m._coin ? 30 : -30)}deg)` })
      // the bots glance at the headline as it lands
      if (!m._coin && t > 0.7 && !m._looked) {
        m._looked = true
        const dx = (W / 2 - (x0 + c * (size + gap))) / W, dy = (H / 2 - (y0 + r * (size + gap))) / H
        m.innerHTML = markSVG(FAMILY[m._i][0], FAMILY[m._i][1], clamp(dx * 2.2, -0.8, 0.8), clamp(dy * 2.2, -0.6, 0.6))
      }
    })
    playWords(head, t, 0.25, 0.16, 1.85)
    place(head, (W - head.offsetWidth) / 2, (H - head.offsetHeight) / 2)
    css(veil, { opacity: rng(t, 0.2, 0.5) * (1 - go) })
  }
})

// 2-4. the real matrix page: rows stream in (newest), the cursor sorts by tokens & grok bots, the camera glides down
scene(B1, B7 + 0.05, (root) => {
  const v = uiView(root, V ? 'm-matrix' : 'matrix')
  const head = words(root, L('All in <span class="hl-gain">one table.</span> Live.', 'All in<br><span class="hl-gain">one table.</span><br>Live.'), 'h1 abs')
  css(head, { fontSize: L(130, 140) + 'px', textAlign: 'center', lineHeight: 1.04 })
  const veil = el('div', 'abs', root)
  css(veil, { pointerEvents: 'none', inset: 0, background: 'radial-gradient(60% 46% at 50% 50%, rgba(10,10,10,.92) 30%, rgba(10,10,10,.55) 70%, rgba(10,10,10,.15))' })
  root.appendChild(head)
  // newest first: the slot each data row (in market order 0..9) holds before the sort
  const NEWEST = [9, 5, 3, 8, 2, 7, 1, 6, 4, 0] // slot -> row
  const posNew = NEWEST.map((_, i) => NEWEST.indexOf(i))
  const CLICK = B3 + 2 * (MB / 4) // on the snare of bar 4
  let rows = null, slot = null, nums = null, targets = null
  const counts = []
  return (t) => {
    if (!v.sr) return
    if (!rows) {
      rows = $$(v, '.mx-row').slice(1)
      rows.forEach((r) => css(r, { animation: 'none', transition: 'none' }))
      $$(v, '.mx-row *').forEach((e) => { if (getComputedStyle(e).transitionDuration !== '0s') e.style.transition = 'none' })
      slot = rows.map((_, i) => box(v, 'row' + i, '.mx-row', i + 1).y)
      nums = rows.map((r) => r.querySelector('.mx-i'))
      targets = $$(v, '.mx-totals dd').map((d) => d.textContent)
      $$(v, '.mx-totals dd').forEach((d) => counts.push(d))
    }
    const tbl = box(v, 'tbl', '.mx-table'), srt = box(v, 'srt', '.mx-sort'), title = box(v, 'title', '.pg-title')
    const tok = box(v, 'tok', '.mx-sort button', 0), tot = box(v, 'tot', '.mx-totals')
    const r0 = box(v, 'row0', '.mx-row', 1), r9 = box(v, 'row9', '.mx-row', 10)
    const pull = eInOut(rng(t, B6, B6 + 0.9)) // the closing pull-back and tilt
    if (V) {
      const ty = title.y + 40
      camera(v, t, [[B1, 215, ty + 60, 2.45], [B1 + 1.3, 215, ty + 160, 2.42], [B1 + 2.6, 215, tot.y + 300, 2.4], [B3, 215, srt.y + 330, 2.4],
        [B3 + 0.8, 215, srt.y + 300, 2.45], [B3 + 2.3, 215, srt.y + 330, 2.4], [B5, 215, r0.y + 250, 2.4],
        [B5 + 0.5, 215, r0.y + 330, 2.4], [B6 - 0.2, 215, r9.y + 120, 2.4], [B6, 215, r9.y + 120, 2.4], [B6 + 1.0, 215, tbl.y + tbl.h * 0.5, 0.62], [B7, 215, tbl.y + tbl.h * 0.5, 0.58]])
    } else {
      camera(v, t, [[B1, 560, title.y + 50, 2.1], [B1 + 1.2, 700, title.y + 160, 1.5], [B1 + 2.4, 800, tbl.y + 140, 1.3], [B3, 800, tbl.y + 170, 1.32],
        [B3 + 0.75, 620, srt.y + 150, 1.85], [B3 + 1.9, 640, srt.y + 190, 1.75], [B5 - 0.2, 860, tbl.y + 230, 1.42],
        [B5 + 0.5, 600, r0.y + 60, 2.3], [B6 - 0.1, 880, r9.y - 20, 2.25], [B6, 885, r9.y - 10, 2.25], [B6 + 1.0, 800, tbl.y + tbl.h * 0.45, 0.95], [B7, 800, tbl.y + tbl.h * 0.45, 0.9]])
    }
    // the table tips back like a sheet on a desk for the closing line
    css(v.wrap, { transform: `perspective(${L(1700, 2200)}px) rotateX(${pull * 26}deg) translateY(${pull * L(30, 60)}px)`, transformOrigin: '50% 60%', opacity: clamp(rng(t, B1, B1 + 0.3) * 2) * (1 - eIn(rng(t, B7 - 0.35, B7))) })
    pageIn(v, t, B1 + 0.05)
    // totals count up to the snapshot's real values
    counts.forEach((d, i) => {
      const s = targets[i], k = eOut(rng(t, B1 + 1.0 + i * 0.12, B1 + 2.2 + i * 0.12), 4)
      const m = /^([^\d]*)([\d.]+)(.*)$/.exec(s)
      if (!m) { d.textContent = s; return }
      const dec = (m[2].split('.')[1] || '').length
      d.textContent = m[1] + (parseFloat(m[2]) * k).toFixed(dec) + m[3]
    })
    cascade($$(v, '.mx-totals > div'), t, B1 + 0.7, 0.09, 24)
    cascade([...$$(v, '.mx-sort'), ...$$(v, '.mx-th')], t, B1 + 1.2, 0.1, 20)
    // sort tabs: newest is on until the click
    const sorted = t >= CLICK
    $$(v, '.mx-sort button').forEach((b, i) => { const on = sorted ? i === 0 : i === 1; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) })
    // rows: stream in top to bottom in newest order, then glide to market order after the click
    rows.forEach((r, i) => {
      const p = posNew[i]
      const tin = B1 + 1.55 + p * 0.17
      const k = expoOut(rng(t, tin, tin + 0.55))
      const f = eInOut(rng(t, CLICK + 0.08 + Math.abs(p - i) * 0.012 + i * 0.03, CLICK + 0.78 + i * 0.03))
      const dy = (slot[p] - slot[i]) * (1 - f)
      const lift = Math.sin(f * Math.PI) * (i === 0 ? 1 : 0.35)
      css(r, {
        opacity: clamp(k * 1.5),
        transform: `translate(${(1 - k) * L(80, 60) + lift * L(10, 6)}px, ${dy + (1 - k) * 12}px) scale(${1 + lift * 0.02})`,
        zIndex: String(i === 0 ? 5 : 1 + Math.round(lift * 3)),
        boxShadow: lift > 0.05 ? `0 ${18 * lift}px ${40 * lift}px rgba(0,0,0,${0.6 * lift})` : 'none',
        background: k < 1 ? `rgba(255,255,255,${0.12 * (1 - k)})` : (lift > 0.05 ? (i === 0 ? '#1a1a1b' : '#141415') : ''),
      })
      if (nums[i]) nums[i].textContent = String(f > 0.5 ? i : p).padStart(2, '0')
    })
    // live: fresh numbers flash on the table while the camera glides
    const flashes = [[B5 + 0.6, 1], [B5 + 1.2, 4], [B5 + 1.7, 6], [B5 + 2.3, 7], [B5 + 2.9, 9], [B5 + 3.3, 3]]
    rows.forEach((r, i) => {
      const cells = r.querySelectorAll('[data-label="wallet"], [data-label="mc"]')
      const on = flashes.some(([ft, ri]) => ri === i && t >= ft && t < ft + 0.9)
      cells.forEach((c) => c.classList.toggle('flash-up', on))
    })
    // the cursor: clicks the sort tab, then rides down the rows (their real hover shows)
    const [bx, by] = centre(v, tok, 0.5, 0.55)
    const cur = [[B3 + 0.6, bx + L(260, 200), by + L(220, 260)], [CLICK - 0.12, bx, by], [CLICK + 0.5, bx + 4, by + 3]]
    if (!V) {
      cur.push([B5 - 0.3, ...onStage(v, r0.x + r0.w * 0.4, r0.y + r0.h * 0.5)])
      cur.push([B6 - 0.2, ...onStage(v, r9.x + r9.w * 0.62, r9.y + r9.h * 0.5)])
    }
    CURSOR = [cur, [CLICK]]
    if (t > B6 - 0.1) CURSOR = null
    // the closing line over the tipped table
    playWords(head, t, B6 + 0.35, 0.12, B7 - 0.4)
    place(head, (W - head.offsetWidth) / 2, (H - head.offsetHeight) / 2 + L(-40, -80))
    css(veil, { opacity: rng(t, B6 + 0.2, B6 + 0.8) * (1 - eIn(rng(t, B7 - 0.35, B7))) })
  }
})

// 5. launch yours: the family runs across, "Launch a bot. It joins the matrix."
scene(B7, B8 + 0.05, (root) => {
  const run = clipImg('family_run'); root.appendChild(run)
  const head = words(root, L('Launch a bot. <span class="hl-violet">It joins the matrix.</span>', 'Launch a bot.<br><span class="hl-violet">It joins<br>the matrix.</span>'), 'h1 abs')
  css(head, { fontSize: L(100, 124) + 'px', textAlign: 'center', lineHeight: 1.04 })
  const rw = L(W * 1.0, W * 1.5)
  return (t) => {
    playClip(run, t, B7 - 1.3)
    const rh = rw * 900 / 1600
    place(run, (W - rw) / 2, L(H * 0.6 - rh * 0.5, H * 0.6 - rh * 0.5), rw, rh)
    css(run, { opacity: rng(t, B7, B7 + 0.1) * (1 - rng(t, B8 - 0.3, B8)) })
    playWords(head, t, B7 + 0.1, 0.1, B8 - 0.35)
    place(head, (W - head.offsetWidth) / 2, L(120, 250))
  }
})

// 6. end card: the family drops in, logo, feature line, CTA, url
scene(B8, DURATION, (root) => {
  const lu = clipImg(V ? 'lineup_v' : 'lineup'); root.appendChild(lu)
  const lw = L(2000, 1380), lh = V ? lw : lw * 900 / 1600
  const mark = el('div', 'mark', root, markSVG('house', 'sphere'))
  const word = words(root, 'GrokGrid', 'h1 abs')
  css(word, { fontSize: L(130, 130) + 'px' })
  const line = words(root, 'The matrix. <span class="dim">Every bot, one live table.</span>', 'sub abs')
  css(line, { fontSize: L(40, 42) + 'px', color: '#fff' })
  const cta = el('div', 'cta', root, `Open the matrix <svg width="26" height="26" viewBox="0 0 26 26"><path d="M6 13h14M14 7l6 6-6 6" stroke="#0a0a0a" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`)
  const url = el('div', 'url-pill', root, 'grokgrid.fun')
  return (t) => {
    playClip(lu, t, B8 + 0.05)
    place(lu, (W - lw) / 2, L(-130, H * 0.5 - 0.55 * lh), lw, lh)
    css(lu, { opacity: rng(t, B8, B8 + 0.1) })
    const ms = 112
    const kw = pop(rng(t, B8 + 0.55, B8 + 1.35))
    const rowW = ms + 24 + (word.offsetWidth || 500)
    const y = L(50, 300)
    place(mark, (W - rowW) / 2, y + 8, ms, ms)
    const blink = t > 20.0 && t < 20.16 ? 0.12 : 1
    const lk = eInOut(rng(t, 19.4, 19.8))
    mark.innerHTML = markSVG('house', 'sphere', 0.45 - 0.5 * lk, -0.35 + 0.3 * lk, blink)
    css(mark, { transform: `scale(${kw}) rotate(${(1 - kw) * -30}deg)`, opacity: clamp(kw * 3) })
    playWords(word, t, B8 + 0.65, 0)
    place(word, (W - rowW) / 2 + ms + 24, y)
    playWords(line, t, B8 + 1.0, 0.07)
    place(line, (W - line.offsetWidth) / 2, y + L(158, 168))
    const kc = pop(rng(t, B8 + 1.45, B8 + 2.15))
    place(cta, (W - cta.offsetWidth) / 2, L(H - 250, H - 560))
    css(cta, { opacity: clamp(kc * 3), transform: `scale(${0.6 + 0.4 * kc})` })
    const ku = expoOut(rng(t, B8 + 1.8, B8 + 2.5))
    place(url, (W - url.offsetWidth) / 2, L(H - 135, H - 440))
    css(url, { opacity: ku, transform: `translateY(${(1 - ku) * 20}px)` })
  }
})
