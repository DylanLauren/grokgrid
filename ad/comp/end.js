// Runs after the cut's scenes: the frame clock, fade to black, readiness and mouse hooks for render.js.
stage.appendChild(cursor)
stage.appendChild(ripple)
// every video ends on black
const fade = el('div', 'abs')
css(fade, { inset: '0', background: '#000', zIndex: 60, opacity: 0 })

// ---------- seek ----------
window.seek = function (t) {
  grid.style.transform = `translate(${(t * 6) % 64}px, ${(t * 3) % 64}px)`
  glow.style.opacity = 0.8 + 0.2 * Math.sin(t * 0.8)
  grain(Math.floor(t * FPS))
  for (const s of SCENES) {
    const on = t >= s.t0 && t < s.t1
    s.root.style.display = on ? 'block' : 'none'
    if (on) s.update(t)
  }
  if (CURSOR) runCursor(t, CURSOR[0], CURSOR[1])
  else runCursor(t, null)
  CURSOR = null
  fade.style.opacity = eInOut(rng(t, DURATION - 1.3, DURATION - 0.1))
}
window.ready = async function () {
  await Promise.all(UI_LOADS)
  await document.fonts.ready
  const imgs = [...document.images].filter((i) => i.src)
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))))
}
window.DURATION = DURATION
// for render.js: where the real mouse goes, what to send, which pages to scroll
// render.js moves the real mouse here so the redrawn UI shows its real hover states
window.mouseAt = function () {
  const c = stage.querySelector('.cursor')
  if (!(c.style.opacity > 0.01)) return null
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(c.style.transform)
  return m ? [+m[1], +m[2]] : null
}
window.FPS = FPS
seek(+(Q.get('t') || 0))

