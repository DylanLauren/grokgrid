// Media for Grok Bot's X posts, in the site's look: dark ink, Geist / Geist Mono, green and
// red only for money, the white-sphere mascot. Cards are PNGs rendered from local HTML in a
// headless Chrome with a throwaway profile; the only network fetch is the coin picture.
// Notable moments also get a short silent MP4 (frames piped to ffmpeg), skipped without ffmpeg.
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FONTS = new URL('../public/fonts/', import.meta.url);
const font = name => `data:font/woff2;base64,${readFileSync(fileURLToPath(new URL(name, FONTS))).toString('base64')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(p => existsSync(p)) || null;

// Same hosts the site accepts for coin pictures. Anything else, any redirect, or more than
// 2 MB is refused; the body is read with a running byte cap.
const IMAGE_HOSTS = /^([a-z0-9-]+\.)*(ipfs\.io|pump\.fun|mypinata\.cloud|dexscreener\.com|arweave\.net|nftstorage\.link|irys\.xyz)$/i;
const MAX_IMAGE = 2_000_000;

/** The coin picture as a data URI (allowlisted https hosts, image types, 2 MB max), or null. */
export async function coinImage(url, fetchImpl = fetch) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !IMAGE_HOSTS.test(u.hostname)) return null;
    const r = await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\/(png|jpe?g|webp|gif)/.test(type) || Number(r.headers.get('content-length') || 0) > MAX_IMAGE || !r.body) return null;
    const chunks = []; let size = 0;
    for await (const chunk of r.body) { size += chunk.length; if (size > MAX_IMAGE) return null; chunks.push(chunk); }
    return `data:${type.split(';')[0]};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch { return null; }
}

const MASCOT = `<svg viewBox="0 0 120 120" class="bot"><defs><radialGradient id="g" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e9e9e9"/><stop offset="1" stop-color="#bdbdbd"/></radialGradient></defs>
<circle cx="60" cy="60" r="54" fill="url(#g)"/><rect x="40" y="44" width="11" height="26" rx="5.5" fill="#0b0b0b"/><rect x="69" y="44" width="11" height="26" rx="5.5" fill="#0b0b0b"/></svg>`;

function shell(body, { width, height }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(${font('Geist-Variable.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:'Geist Mono';src:url(${font('GeistMono-Variable.woff2')}) format('woff2');font-weight:100 900}
:root{--ink:#0a0a0a;--card:#141414;--paper:#fff;--p70:rgba(255,255,255,.7);--p50:rgba(255,255,255,.5);--hair:rgba(255,255,255,.1);--gain:#4ade80;--loss:#f87171}
*{box-sizing:border-box;margin:0}html,body{width:${width}px;height:${height}px;background:var(--ink);color:var(--paper);font-family:Geist,sans-serif;overflow:hidden}
.frame{position:absolute;inset:0;padding:56px 64px;display:flex;flex-direction:column;background:radial-gradient(1200px 600px at 85% -10%,#1b1b1b,transparent 60%),var(--ink)}
.top{display:flex;align-items:center;gap:16px;font-size:26px;font-weight:600;letter-spacing:-.02em}.bot{width:56px;height:56px}
.top small{margin-left:auto;font-family:'Geist Mono';font-size:20px;color:var(--p50);font-weight:400}
.card{margin-top:auto;background:var(--card);border:1px solid var(--hair);border-radius:28px;padding:36px 40px;display:flex;gap:32px;align-items:center}
.coin{width:150px;height:150px;border-radius:24px;object-fit:cover;background:#222;flex:none}
.side{display:inline-block;font-family:'Geist Mono';font-size:22px;padding:6px 14px;border-radius:999px;text-transform:uppercase;letter-spacing:.06em}
.buy{background:rgba(74,222,128,.14);color:var(--gain)}.sell{background:rgba(248,113,113,.14);color:var(--loss)}.neutral{background:rgba(255,255,255,.1);color:var(--paper)}
.tick{font-size:64px;font-weight:700;letter-spacing:-.04em;margin:10px 0 4px}
.amt{font-family:'Geist Mono';font-size:40px}.amt b{font-weight:500}.gain{color:var(--gain)}.loss{color:var(--loss)}
.meta{margin-top:auto;padding-top:28px;display:flex;justify-content:space-between;font-family:'Geist Mono';font-size:20px;color:var(--p50)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:auto}.stat{background:var(--card);border:1px solid var(--hair);border-radius:24px;padding:26px 28px}
.stat span{display:block;font-family:'Geist Mono';font-size:18px;color:var(--p50);text-transform:uppercase;letter-spacing:.06em}.stat b{display:block;font-size:46px;font-weight:650;letter-spacing:-.03em;margin-top:8px}
</style></head><body>${body}</body></html>`;
}

const sol = l => (Number(BigInt(l)) / 1e9).toFixed(3);
const pct = p => `${p >= 0 ? '+' : ''}${Math.round(p)}%`;

/** One real trade. d: { side, symbol, image, lamports, pnlPct?, signature, agent } */
export function tradeHtml(d, size = { width: 1200, height: 675 }) {
  const img = d.image ? `<img class="coin" src="${esc(d.image)}">` : `<div class="coin"></div>`;
  const pnl = Number.isFinite(d.pnlPct) ? ` <span class="${d.pnlPct >= 0 ? 'gain' : 'loss'}" data-count="${d.pnlPct}">${pct(d.pnlPct)}</span>` : '';
  return shell(`<div class="frame"><div class="top">${MASCOT}grok grid<small>${esc(d.agent === 'house' ? 'house bot' : d.agent)}</small></div>
<div class="card" data-slide>${img}<div><span class="side ${d.side}">${d.side === 'buy' ? 'bought' : 'sold'}</span>
<div class="tick">$${esc(d.symbol || '???')}</div><div class="amt"><b data-count="${sol(d.lamports)}">${sol(d.lamports)}</b> SOL${pnl}</div></div></div>
<div class="meta"><span>tx ${esc(d.signature.slice(0, 6))}…${esc(d.signature.slice(-6))}</span><span>grokgrid-alpha.vercel.app</span></div></div>`, size);
}

/** A $GRID burn or a new bot launch. */
export function eventHtml(d, size = { width: 1080, height: 1080 }) {
  const title = d.kind === 'burn' ? `burned ${Number(d.amount).toLocaleString('en-US')} $GRID` : `new bot: $${esc(d.symbol || '???')}`;
  const sub = d.kind === 'burn' ? `bought back with ${sol(d.lamports)} SOL of fees` : `launched on the grid · trades from its own wallet`;
  const img = d.image ? `<img class="coin" src="${esc(d.image)}">` : `<div class="coin"></div>`;
  return shell(`<div class="frame"><div class="top">${MASCOT}grok grid<small>${d.kind}</small></div>
<div class="card" data-slide>${img}<div><span class="side neutral">${d.kind}</span><div class="tick" style="font-size:54px">${title}</div><div class="amt" style="font-size:28px;color:var(--p70)">${sub}</div></div></div>
<div class="meta"><span>${d.signature ? `tx ${esc(d.signature.slice(0, 6))}…${esc(d.signature.slice(-6))}` : ''}</span><span>grokgrid-alpha.vercel.app</span></div></div>`, size);
}

/** The 00:00 UTC recap. d: { day, trades, winRate, solIn, solOut, burned, workersOnline, workersTotal } */
export function recapHtml(d, size = { width: 1200, height: 675 }) {
  const stat = (k, v, cls = '') => `<div class="stat"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const net = d.solIn - d.solOut;
  return shell(`<div class="frame"><div class="top">${MASCOT}grok grid · daily recap<small>${esc(d.day)} UTC</small></div><div class="grid">
${stat('trades', d.trades)}${stat('win rate', d.winRate === null ? '—' : `${Math.round(d.winRate * 100)}%`)}${stat('net SOL', `${net >= 0 ? '+' : ''}${net.toFixed(3)}`, net >= 0 ? 'gain' : 'loss')}
${stat('SOL in', d.solIn.toFixed(3))}${stat('$GRID burned', Number(d.burned).toLocaleString('en-US'))}${stat('workers online', `${d.workersOnline}/${d.workersTotal}`)}
</div><div class="meta"><span>strategy unvalidated · not financial advice</span><span>grokgrid-alpha.vercel.app</span></div></div>`, size);
}

async function browser(launcher) {
  const { chromium } = launcher || (await import('playwright-core'));
  // Local HTML only, in a throwaway profile; the system Chrome is just the renderer.
  return chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-extensions', '--no-first-run'] });
}

export async function renderPng(html, outFile, { width, height }, launcher) {
  const b = await browser(launcher);
  try {
    const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route('**/*', r => r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outFile, type: 'png' });
    return outFile;
  } finally { await b.close(); }
}

/**
 * A 7s, 30fps, 1080x1080 silent H.264 clip: the card slides in and numbers count up.
 * Returns null (post the card instead) when ffmpeg isn't installed.
 */
export async function renderMp4(html, outFile, launcher, { seconds = 7, fps = 30, size = 1080 } = {}) {
  if (!FFMPEG) return null;
  const b = await browser(launcher);
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-vf', `scale=${size}:${size}`, outFile], { stdio: ['pipe', 'ignore', 'pipe'] });
  const done = new Promise((ok, fail) => ff.on('close', code => code === 0 ? ok(outFile) : fail(Error(`ffmpeg exited ${code}`))));
  try {
    const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.route('**/*', r => r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Deterministic frames: each one sets the animation time explicitly.
    await page.evaluate(() => {
      const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
      const nums = [...document.querySelectorAll('[data-count]')].map(el => ({ el, to: Number(el.dataset.count), text: el.textContent }));
      const slide = document.querySelector('[data-slide]');
      window.__frame = t => {
        if (slide) { const k = ease(t / 0.9); slide.style.transform = `translateY(${(1 - k) * 120}px)`; slide.style.opacity = String(k); }
        for (const n of nums) { const k = ease((t - 0.6) / 1.6); const v = n.to * k; n.el.textContent = n.text.includes('%') ? `${v >= 0 ? '+' : ''}${Math.round(v)}%` : v.toFixed(3); }
      };
    });
    for (let f = 0; f < seconds * fps; f++) {
      await page.evaluate(t => window.__frame(t), f / fps);
      if (!ff.stdin.write(await page.screenshot({ type: 'png' }))) await new Promise(r => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    return await done;
  } catch (e) { ff.kill('SIGKILL'); throw e; }
  finally { await b.close(); }
}

/**
 * Hook for Grok-made art. Stays unimplemented until dlao provides an xAI API key; the
 * posting flow treats a null result as "use the rendered card".
 */
export async function generateArt(prompt, { apiKey } = {}) {
  void prompt;
  if (!apiKey) return null;
  throw Error('generateArt is not implemented yet: add the xAI image call here once an API key exists');
}
