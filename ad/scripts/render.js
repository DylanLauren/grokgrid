// node render.js <w> <h> <outdir> [t0] [t1] [--stills t,t,t]
const { chromium } = require('playwright')
const fs = require('fs')
const [w, h, out] = [+process.argv[2], +process.argv[3], process.argv[4]]
const stillArg = process.argv.indexOf('--stills')
const extra = process.env.QS || ''
;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: w, height: h } })
  p.on('pageerror', (e) => console.log('pageerror', e.message))
  await p.goto(`http://127.0.0.1:8811/comp/index.html?w=${w}&h=${h}${extra}`)
  await p.waitForTimeout(800)
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
    await p.evaluate(() => window.ready())
    const name = stillArg > 0 ? `t_${t.toFixed(2)}` : `f_${String(Math.round(t * fps)).padStart(5, '0')}`
    await p.screenshot({ path: `${out}/${name}.${stillArg > 0 ? 'jpg' : 'png'}`, ...(stillArg > 0 ? { quality: 80 } : {}) })
  }
  await b.close()
  console.log('rendered', times.length)
})()
