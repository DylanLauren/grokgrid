// Builds the README art from the site's own pieces: the BotMark mascots (every shape and
// colour), the Geist fonts and the site's colour tokens. Screenshots come from the live site.
//   npx tsx docs/assets/build.tsx            banner, diagrams and screenshots
//   npx tsx docs/assets/build.tsx --no-shots skip the live-site screenshots
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'
const { createElement } = React
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
// The site's components use the automatic JSX runtime; tsx compiles them classically here.
;(globalThis as { React?: typeof React }).React = React
const { BotMark, FAMILY } = await import('../../src/ui/BotMark')

const OUT = fileURLToPath(new URL('./', import.meta.url))
const font = (n: string) => `data:font/woff2;base64,${readFileSync(fileURLToPath(new URL(`../../public/fonts/${n}`, import.meta.url))).toString('base64')}`
const bot = (size: number, color: string, shape: string, look: [number, number]) =>
  renderToStaticMarkup(createElement(BotMark, { size, color, shape: shape as never, look }))

const page = (body: string, w: number, h: number) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(${font('Geist-Variable.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:'Geist Mono';src:url(${font('GeistMono-Variable.woff2')}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0}html,body{width:${w}px;height:${h}px;background:#0a0a0a;color:#fff;font-family:Geist,sans-serif;overflow:hidden}
.mono{font-family:'Geist Mono'}.dim{color:rgba(255,255,255,.5)}.gain{color:#4ade80}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:40px 40px;mask-image:radial-gradient(ellipse at 50% 40%,#000 30%,transparent 75%)}
.card{background:#141414;border:1px solid rgba(255,255,255,.1);border-radius:22px}
</style></head><body>${body}</body></html>`

// 1280x640: the GitHub social preview size.
function banner() {
  const looks: [number, number][] = [[0.5, -0.3], [-0.4, -0.2], [0.2, 0.4], [-0.5, 0.3], [0.6, 0.1], [-0.2, -0.5], [0.3, -0.4], [-0.6, 0], [0.1, 0.5]]
  const ring = FAMILY.map((f, i) => {
    const a = (i / FAMILY.length) * Math.PI * 2 - Math.PI / 2
    const x = 940 + Math.cos(a) * 200, y = 320 + Math.sin(a) * 200
    return `<div style="position:absolute;left:${x - 56}px;top:${y - 56}px;width:112px;height:112px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.07),transparent 70%);display:grid;place-items:center">${bot(88, f.color, f.shape, looks[i])}</div>`
  }).join('')
  return page(`<div class="grid"></div>
<div style="position:absolute;left:96px;top:150px;width:560px">
  <div style="display:flex;align-items:center;gap:18px">${bot(64, 'house', 'sphere', [0.45, -0.35])}<span style="font-size:30px;font-weight:600;letter-spacing:-.02em">grok grid</span></div>
  <h1 style="font-size:64px;line-height:1.02;letter-spacing:-.045em;font-weight:700;margin-top:28px">AI trading bots<br>that launch as coins.</h1>
  <p class="dim" style="font-size:24px;line-height:1.4;margin-top:22px">Grok Bot trades pump.fun live at his desk.<br>Launch your own bot with its coin; it trades from its own wallet.</p>
  <p class="mono dim" style="font-size:17px;margin-top:30px;white-space:nowrap">$GRID · buy-and-burn · live phone · receipts on chain</p>
</div>
${ring}<div style="position:absolute;left:880px;top:260px">${bot(120, 'house', 'sphere', [0, 0])}</div>`, 1280, 640)
}

// How the pieces connect. Plain boxes and lines in the site's card style.
function architecture() {
  const box = (x: number, y: number, w: number, title: string, lines: string[]) =>
    `<div class="card" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;padding:18px 20px"><div style="font-size:20px;font-weight:600">${title}</div>${lines.map(l => `<div class="mono dim" style="font-size:14px;margin-top:6px">${l}</div>`).join('')}</div>`
  const line = (x1: number, y1: number, x2: number, y2: number, label = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,.35)" stroke-width="1.5" marker-end="url(#a)"/>${label ? `<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2 - 6}" fill="rgba(255,255,255,.55)" font-family="Geist Mono" font-size="13">${label}</text>` : ''}`
  return page(`<div class="grid"></div>
<div style="position:absolute;left:48px;top:32px;display:flex;align-items:center;gap:12px">${bot(36, 'house', 'sphere', [0.45, -0.35])}<span style="font-size:24px;font-weight:600">how grok grid fits together</span></div>
<svg width="1400" height="860" style="position:absolute;inset:0"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="rgba(255,255,255,.5)"/></marker></defs>
${line(330, 200, 530, 200, 'pages + API')}${line(830, 200, 1000, 200, 'chain')}${line(680, 300, 680, 420, 'outbox, status')}${line(880, 440, 1000, 330, 'trades, quotes')}${line(680, 640, 680, 720, 'sign')}${line(880, 540, 1060, 560, 'posts')}${line(880, 600, 1060, 720, 'calls')}${line(480, 520, 330, 470, 'frames')}</svg>
${box(48, 140, 280, 'Visitors', ['3D room · Grid · Matrix', 'Stats · Docs', 'launch a bot + coin'])}
${box(530, 130, 300, 'Vercel site + API', ['React + three.js', '/api/agents · /api/feed', '/api/launch/* · /api/status', 'Upstash Redis store'])}
${box(1000, 130, 340, 'Solana / pump.fun', ['bonding curve + PumpSwap', '80/20 creator-fee split', 'finalized receipts', '$GRID SPL burns'])}
${box(480, 420, 400, 'The Mac runtime (launchd)', ['observer · trading worker', 'strategy (paper → live)', 'agent runner · buy-and-burn', 'callouts · X posts · heartbeats'])}
${box(48, 360, 280, 'Live phone', ['pinned pump.fun window', 'frames + LiveKit video', 'on demand: "watch me trade"'])}
${box(480, 720, 400, 'Signing', ['house: local key (0600)', 'user bots: Privy server wallets', 'policy-capped, journaled first'])}
${box(1060, 680, 300, 'pump.fun Callouts', ['GrokGrid profile', '1 per 6h, held coins only'])}
${box(1060, 500, 300, 'X account', ['trade cards + clips', 'burns · launches · recaps'])}`, 1400, 860)
}

function moneyFlow() {
  const row = (y: number, from: string, splits: [string, number, string][]) => `<div style="position:absolute;left:64px;top:${y}px;width:1072px">
<div style="font-size:22px;font-weight:600;margin-bottom:14px">${from}</div><div style="display:flex;gap:10px">${splits.map(([label, pct, note]) =>
    `<div class="card" style="flex:${pct};padding:18px 20px;${label.includes('burn') ? 'border-color:rgba(74,222,128,.35)' : ''}"><div class="mono" style="font-size:34px;font-weight:600">${pct}%</div><div style="font-size:18px;margin-top:6px">${label}</div><div class="dim" style="font-size:14px;margin-top:4px">${note}</div></div>`).join('')}</div></div>`
  return page(`<div class="grid"></div>
<div style="position:absolute;left:64px;top:44px;display:flex;align-items:center;gap:12px">${bot(36, 'house', 'sphere', [0.45, -0.35])}<span style="font-size:24px;font-weight:600">where the money goes</span></div>
${row(130, '$GRID creator fees', [['house bot treasury', 80, 'funds the house bot’s own trading'], ['buy and burn', 20, 'buys $GRID and burns it on chain']])}
${row(330, 'each bot coin’s creator fees', [['that bot’s own wallet', 80, 'its trading money, never shared'], ['$GRID burn wallet', 20, 'more $GRID bought and burned']])}
<div class="mono dim" style="position:absolute;left:64px;top:540px;font-size:15px;line-height:1.6;width:1072px">Splits are written into each coin at launch and verified on chain. Today the house bot doesn’t move money into other bots: each bot trades only its own wallet, inside its owner’s rules and the global caps.</div>`, 1200, 620)
}

async function render(html: string, file: string, w: number, h: number, b: Awaited<ReturnType<typeof chromium.launch>>) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
  await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready)
  await p.screenshot({ path: `${OUT}${file}`, type: 'png' }); await p.close()
}

async function shots(b: Awaited<ReturnType<typeof chromium.launch>>) {
  mkdirSync(`${OUT}screens`, { recursive: true })
  const site = 'https://grokgrid-alpha.vercel.app'
  for (const [name, path, wait] of [['room', '/', 9000], ['grid', '/#grid', 6000], ['matrix', '/#matrix', 6000], ['stats', '/#stats', 6000], ['docs', '/#docs', 5000]] as const) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await p.goto(site + path, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(wait)
    await p.getByText('skip', { exact: true }).click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(800)
    await p.screenshot({ path: `${OUT}screens/${name}.png`, type: 'png' }); await p.close()
  }
}

const b = await chromium.launch({ channel: 'chrome', headless: true })
try {
  await render(banner(), 'banner.png', 1280, 640, b)
  await render(architecture(), 'architecture.png', 1400, 860, b)
  await render(moneyFlow(), 'money-flow.png', 1200, 620, b)
  if (!process.argv.includes('--no-shots')) await shots(b)
} finally { await b.close() }
