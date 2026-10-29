#!/usr/bin/env node
// Keeps the site's phone on: puts the pinned pump.fun Chrome window back to phone size, out of
// full screen and on the house profile, hides its scrollbar, then resumes the feed if it
// stopped for a window problem.
// Touches only that one window and never reads page contents. launchd runs it every 30 seconds.
//   node scripts/phone-guardian.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_GUARDIAN, HIDE_SCROLLBAR_JS, windowFixes, shouldResume } from './phone-guardian-core.mjs';

const run = promisify(execFile);
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const read = async (name, fallback) => { try { return JSON.parse(await readFile(join(root, name), 'utf8')); } catch { return fallback; } };
const osa = async script => (await run('osascript', ['-e', script], { timeout: 15000 })).stdout.trim();
const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

async function tick() {
  const cfg = await read('local-phone-config.json', null);
  if (!cfg?.browserUrl || !cfg?.title) throw Error('phone config missing');
  const bounds = { ...DEFAULT_GUARDIAN.bounds, ...((await read('phone-guardian-config.json', {})).bounds || {}) };
  const pick = `first window whose URL of active tab starts with ${q(cfg.browserUrl)}`;
  let w = null;
  try {
    const [x1, y1, x2, y2, ...url] = (await osa(`tell application "Google Chrome" to get {bounds, URL of active tab} of (${pick})`)).split(', ');
    w = { bounds: { x: +x1, y: +y1, width: x2 - x1, height: y2 - y1 }, url: url.join(', ') };
    try { w.fullScreen = (await osa(`tell application "System Events" to tell process "Google Chrome" to get value of attribute "AXFullScreen" of (first window whose name starts with ${q(cfg.title)})`)) === 'true'; } catch { w.fullScreen = null; }
  } catch {}
  const fixes = windowFixes(w, cfg.browserUrl, bounds), done = [];
  for (const f of fixes) {
    try {
      if (f === 'exit-full-screen') { await osa(`tell application "System Events" to tell process "Google Chrome" to set value of attribute "AXFullScreen" of (first window whose name starts with ${q(cfg.title)}) to false`); await new Promise(r => setTimeout(r, 2500)); }
      if (f === 'reset-url') await osa(`tell application "Google Chrome" to set URL of active tab of (${pick}) to ${q(cfg.browserUrl)}`);
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
  const status = { observedAt: new Date().toISOString(), windowFound: !!w, fixes: done, resumed };
  const tmp = join(root, '.phone-guardian-status.json.tmp');
  await writeFile(tmp, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, join(root, 'phone-guardian-status.json'));
  console.log(JSON.stringify(status));
}

if (import.meta.url === `file://${process.argv[1]}`) tick().catch(e => { console.error(`phone guardian: ${String(e?.message || e).slice(0, 120)}`); process.exit(1); });
