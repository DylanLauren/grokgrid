// node render.js <w> <h> <outdir> [t0] [t1] [--stills t,t,t]
// Steps the composition frame by frame. Every CSS animation (the redrawn site UI has many: bots bobbing,
// cards, hovers) is pinned to the video time, and the real mouse follows the drawn cursor so the UI shows
// its real hover states. env: QS (extra query string), DSF (device scale factor, default 1)
const { chromium } = require('playwright')
const fs = require('fs')
const [w, h, out] = [+process.argv[2], +process.argv[3], process.argv[4]]
const stillArg = process.argv.indexOf('--stills')
const extra = process.env.QS || ''
const DSF = +(process.env.DSF || 1)

;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: DSF })
  p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)))
  await p.goto(`http://127.0.0.1:8811/comp/index.html?w=${w}&h=${h}${extra}`)
  await p.evaluate(() => window.ready())
  const fps = await p.evaluate(() => window.FPS)
  const dur = await p.evaluate(() => window.DURATION)
  let times
  if (stillArg > 0) times = process.argv[stillArg + 1].split(',').map(Number)
  else {
    const t0 = +(process.argv[5] || 0), t1 = +(process.argv[6] || dur)
    times = []
    for (let f = Math.round(t0 * fps); f < Math.round(t1 * fps); f++) times.push(f / fps)
  }
  for (const t of times) {
    await p.evaluate((t) => window.seek(t), t)
    const m = await p.evaluate(() => window.mouseAt())
    await p.mouse.move(m ? m[0] + 3 : w - 2, m ? m[1] + 3 : h - 2)
    // pin every animation (including ones inside the UI's shadow roots) to video time
    await p.evaluate((now) => {
      const all = [...document.getAnimations()]
      for (const host of document.querySelectorAll('*')) if (host.shadowRoot) all.push(...host.shadowRoot.getAnimations())
      for (const a of all) {
        if (a.__t0 == null) { a.__t0 = now - (a.currentTime || 0); a.pause() }
        a.currentTime = Math.max(0, now - a.__t0)
      }
    }, t * 1000)
    await p.evaluate(() => window.ready())
    const name = stillArg > 0 ? `t_${t.toFixed(2)}` : `f_${String(Math.round(t * fps)).padStart(5, '0')}`
    await p.screenshot({ path: `${out}/${name}.${stillArg > 0 ? 'jpg' : 'png'}`, ...(stillArg > 0 ? { quality: 85 } : {}) })
  }
  await b.close()
  console.log('rendered', times.length)
})()
