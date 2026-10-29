#!/usr/bin/env node
// Keeps the site's phone on and following the house: the pinned pump.fun Chrome window shows the
// coin the house is trading (or its profile when idle), stays phone size and out of full screen,
// has no scrollbar, and the feed resumes if it stopped for a window problem.
// Touches only that one window and never reads page contents. launchd keeps it running: a full
// check every 30 seconds, and the scrollbar style re-applied within about 2 seconds of a reload.
//   node scripts/phone-guardian.mjs [--once]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_GUARDIAN, HIDE_SCROLLBAR_JS, windowFixes, shouldResume } from './phone-guardian-core.mjs';
import { FOLLOW_FILE, followMints, targetPage } from './phone-follow-core.mjs';

const run = promisify(execFile);
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(root, name), 'utf8')); } catch { return fallback; } };
const osa = async script => (await run('osascript', ['-e', script], { timeout: 15000 })).stdout.trim();
const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

async function tick() {
  const cfg = await read('local-phone-config.json', null);
  if (!cfg?.browserUrl || !cfg?.title) throw Error('phone config missing');
  const bounds = { ...DEFAULT_GUARDIAN.bounds, ...((await read('phone-guardian-config.json', {})).bounds || {}) };
  const video = await read('local-phone-video-config.json', {});
  const pick = Number.isSafeInteger(video.chromeWindowId) ? `window id ${video.chromeWindowId}` : `first window whose URL of active tab starts with ${q(cfg.browserUrl)}`;
  // Follow the house: the coins it holds or just traded may be shown. Written before navigating,
  // so the feed and the video capture already accept the page when it loads.
  const now = Date.now(), journal = await read('trading/trading-journal.json', null);
  const mints = followMints(journal?.state, await read('trading-positions.json', null), now);
  const follow = { mints, updatedAt: now };
  const ftmp = join(root, `.${FOLLOW_FILE}.tmp`);
  await writeFile(ftmp, JSON.stringify(follow) + '\n', { mode: 0o600 }); await rename(ftmp, join(root, FOLLOW_FILE));
  const target = targetPage(mints, cfg.browserUrl);
  let w = null;
  try {
    const [x1, y1, x2, y2] = (await osa(`tell application "Google Chrome" to get bounds of (${pick})`)).split(', ').map(Number);
    w = { bounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, url: await osa(`tell application "Google Chrome" to get URL of active tab of (${pick})`),
      name: await osa(`tell application "Google Chrome" to get name of (${pick})`) };
    try { w.fullScreen = (await osa(`tell application "System Events" to tell process "Google Chrome" to get value of attribute "AXFullScreen" of (first window whose name starts with ${q(w.name)})`)) === 'true'; } catch { w.fullScreen = null; }
  } catch {}
  const fixes = windowFixes(w, cfg.browserUrl, bounds, target), done = [];
  for (const f of fixes) {
    try {
      if (f === 'exit-full-screen') { await osa(`tell application "System Events" to tell process "Google Chrome" to set value of attribute "AXFullScreen" of (first window whose name starts with ${q(w.name)}) to false`); await new Promise(r => setTimeout(r, 2500)); }
      if (f === 'show-target') await osa(`tell application "Google Chrome" to set URL of active tab of (${pick}) to ${q(target)}`);
      if (f === 'restore-bounds') await osa(`tell application "Google Chrome" to set bounds of (${pick}) to {${bounds.x}, ${bounds.y}, ${bounds.x + bounds.width}, ${bounds.y + bounds.height}}`);
      done.push(f);
    } catch { done.push(`${f}-failed`); }
  }
  if (w) { try { await osa(`tell application "Google Chrome" to execute active tab of (${pick}) javascript ${q(HIDE_SCROLLBAR_JS)}`); } catch { done.push('hide-scrollbar-failed'); } }
  const paused = join(root, 'phone-app-paused');
  const app = await read('phone-app-status.json', {}), sup = await read('local-phone-supervisor-status.json', {});
  const pausedFile = await access(paused).then(() => true, () => false);
  let resumed = false;
  if (w && !done.some(d => d.endsWith('-failed')) && shouldResume({ pausedFile, appState: app.state, supervisorState: sup.state, supervisorReason: sup.reason })) {
    await unlink(paused).catch(() => {}); resumed = true; // same as the phone app's "Resume" menu item
  }
  const status = { observedAt: new Date(now).toISOString(), windowFound: !!w, showing: w?.url === target ? target : w?.url ?? null, target, fixes: done, resumed };
  const tmp = join(root, '.phone-guardian-status.json.tmp');
  await writeFile(tmp, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, join(root, 'phone-guardian-status.json'));
  console.log(JSON.stringify(status));
}

// Cheap check between full ticks: only re-applies the style when a reload dropped it.
async function keepScrollbarHidden() {
  const video = await read('local-phone-video-config.json', {});
  if (!Number.isSafeInteger(video.chromeWindowId)) return;
  const js = `(()=>document.getElementById('gg-noscroll')?'ok':${HIDE_SCROLLBAR_JS})()`;
  try { await osa(`tell application "Google Chrome" to execute active tab of window id ${video.chromeWindowId} javascript ${q(js)}`); } catch {}
}

async function main() {
  if (process.argv.includes('--once')) return tick();
  for (let next = 0; ; await new Promise(r => setTimeout(r, 1500))) {
    if (Date.now() >= next) { next = Date.now() + 30_000; await tick().catch(e => console.error(`phone guardian: ${String(e?.message || e).slice(0, 120)}`)); }
    else await keepScrollbarHidden();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(`phone guardian: ${String(e?.message || e).slice(0, 120)}`); process.exit(1); });
