// node snapshot.js <outdir>   (env BASE, default https://grokgrid.fun/)
// Saves the site's real rendered UI as markup + stylesheet text, so the ad can redraw it as crisp,
// animatable DOM (in a shadow root) instead of using screenshots. One file per page and layout.
const { chromium } = require('playwright')
const fs = require('fs')
const BASE = process.env.BASE || 'https://grokgrid.fun/'
const OUT = process.argv[2] || '../ui-dom'
const PAGES = [
  ['calls', '#calls', 1600, 1000], ['stats', '#stats', 1600, 1000], ['grid', '#grid', 1600, 1000], ['matrix', '#matrix', 1600, 1000],
  ['m-calls', '#calls', 430, 932], ['m-stats', '#stats', 430, 932], ['m-grid', '#grid', 430, 932], ['m-matrix', '#matrix', 430, 932],
].filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s[0]))
;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await chromium.launch(process.platform === 'linux' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {})
  for (const [name, hash, w, h] of PAGES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } })
    await ctx.addInitScript(() => { try { localStorage.setItem('gg-sound', 'off') } catch (e) {} })
    const p = await ctx.newPage()
    try { await p.goto(BASE + hash, { waitUntil: 'networkidle', timeout: 60000 }) } catch (e) {}
    await p.waitForTimeout(2500)
    try { await p.getByRole('button', { name: /enter/i }).click({ timeout: 6000 }) } catch (e) {}
    await p.waitForTimeout(3000)
    for (let i = 0; i < 2; i++) { try { await p.getByText('skip', { exact: true }).first().click({ timeout: 1500 }) } catch (e) {} await p.waitForTimeout(800) }
    if (name.endsWith('calls')) { try { await p.locator('nav.tabs button', { hasText: 'calls' }).click({ timeout: 4000 }) } catch (e) { console.log('no calls tab') } }
    await p.waitForTimeout(5000)
    const snap = await p.evaluate((base) => {
      const abs = (u) => { try { return new URL(u, base).href } catch (e) { return u } }
      // media queries are settled here, at this page's real width, and viewport units become pixels,
      // so the redrawn UI keeps this exact layout whatever size the ad's own page is
      const flat = (rules) => {
        let o = ''
        for (const r of rules) {
          if (r instanceof CSSMediaRule) { if (matchMedia(r.conditionText).matches) o += flat(r.cssRules) }
          else if (r instanceof CSSSupportsRule) { if (CSS.supports(r.conditionText)) o += flat(r.cssRules) }
          else o += r.cssText + '\n'
        }
        return o
      }
      let css = ''
      for (const sh of document.styleSheets) { try { css += flat(sh.cssRules) } catch (e) {} }
      const vw = innerWidth / 100, vh = innerHeight / 100
      css = css.replace(/(-?[\d.]+)(d|s|l)?v(w|h|min|max)\b/g, (m, n, _, u) => {
        const k = u === 'w' ? vw : u === 'h' ? vh : u === 'min' ? Math.min(vw, vh) : Math.max(vw, vh)
        return (parseFloat(n) * k).toFixed(2) + 'px'
      })
      // url(...) in the CSS must keep working from another origin
      css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => (u.startsWith('data:') ? m : `url("${abs(u)}")`))
      const root = document.getElementById('root').cloneNode(true)
      root.querySelectorAll('canvas, script, video').forEach((e) => e.remove())
      root.querySelectorAll('img[src]').forEach((e) => e.setAttribute('src', abs(e.getAttribute('src'))))
      root.querySelectorAll('[srcset]').forEach((e) => e.removeAttribute('srcset'))
      // the live room stays out: pages and panels are what the ad redraws
      const app = document.querySelector('.app')
      return { css, html: root.innerHTML, appClass: app ? app.className : 'app', bodyClass: document.body.className, vars: getComputedStyle(document.documentElement).cssText ? '' : '' }
    }, BASE)
    snap.vw = w; snap.vh = h
    fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(snap))
    console.log('ok', name, Math.round(snap.html.length / 1024) + 'KB html', Math.round(snap.css.length / 1024) + 'KB css')
    await ctx.close()
  }
  await b.close()
})()
