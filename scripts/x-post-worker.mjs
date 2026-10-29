#!/usr/bin/env node
// Grok Bot's X account: each real reconciled trade (house and launched bots), each $GRID burn,
// each new bot launch, and a daily recap after 00:00 UTC, posted once each with a card in the
// site's style. Notable moments (a sell at +50% or better, a burn, a launch) get a short clip.
// If media fails the post goes out as text. Paper trades never post.
//   --dry-run            print what would post, send nothing
//   --dry-run --render   also write the media to runtime/x-media-preview/ to look at
// Off unless x-config.json sets xPostsEnabled; needs x-credentials.json (0600) from dlao's X app.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { readPrivateText, savePrivateJSON } from './runtime-observation-store.mjs';
import { DEFAULT_X, pendingPosts, postText, postGate, sendPost, validCreds, uploadMedia } from './x-posts.mjs';
import { tradeHtml, eventHtml, recapHtml, renderPng, renderMp4, coinImage } from './x-media.mjs';
import { marketMetrics } from './strategy-data.mjs';
import { planPosts, recapStats, previousUtcDay } from './x-plan.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const args = process.argv.slice(2), dryRun = args.includes('--dry-run'), render = args.includes('--render');
if (args.some(a => !['--once', '--dry-run', '--render'].includes(a)) || (render && !dryRun)) { console.error('Usage: x-post-worker.mjs [--once] [--dry-run [--render]]'); process.exit(1); }
const read = async (name, fallback) => { try { return JSON.parse(await readPrivateText(join(root, name))); } catch { return fallback; } };
const getJson = async url => { try { const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) }); return r.ok ? r.json() : null; } catch { return null; } };

const cfg = { ...DEFAULT_X, ...(await read('x-config.json', {})) };
const ledger = await read('x-posts.json', { version: 1, posted: {} });
const now = Date.now();

// Real trade journals: the house, then each launched bot.
const journals = [];
const house = await read('trading/trading-journal.json', null);
if (house?.state) journals.push({ agent: 'house', state: house.state });
try { for (const id of await readdir(join(root, 'agents'))) { const j = await read(`agents/${id}/trading/trading-journal.json`, null); if (j?.state) journals.push({ agent: id, state: j.state }); } } catch {}
const buyback = (await read('buyback/buyback-journal.json', null))?.state ?? null;
const runner = await read('agent-runner-state.json', { agents: {} });
const registry = (await getJson(`${cfg.site}/api/agents`))?.agents ?? [];
const status = (await getJson(`${cfg.site}/api/status`))?.workers ?? {};

const items = planPosts({ journals, buyback, launches: Object.values(runner.agents || {}).filter(a => a.status === 'ready'), registry, ledger, now, pendingPosts })
  .slice(0, 3);
let meta = new Map();
try { const mints = [...new Set(items.map(i => i.mint).filter(Boolean))]; if (mints.length) meta = await marketMetrics(mints); } catch {}

const previewDir = join(root, 'x-media-preview');
if (render) await mkdir(previewDir, { recursive: true, mode: 0o700 });

async function media(item, dir) {
  const m = meta.get(item.mint), image = item.image ?? await coinImage(m?.image);
  const symbol = item.symbol ?? m?.symbol;
  if (item.kind === 'recap') {
    const html = recapHtml({ ...recapStats(journals, buyback, item.day), workersOnline: Object.values(status).filter(w => w.online).length, workersTotal: Object.keys(status).length || 5 });
    return { png: await renderPng(html, join(dir, `${item.key.replace(/[:]/g, '-')}.png`), { width: 1200, height: 675 }) };
  }
  const card = item.kind === 'trade'
    ? tradeHtml({ side: item.intent.side, symbol, image, lamports: item.lamports, pnlPct: item.pnlPct, signature: item.intent.signature, agent: item.agent })
    : eventHtml({ kind: item.kind, symbol, image, amount: item.amount, lamports: item.lamports, signature: item.signature });
  const base = join(dir, item.key.replace(/[:]/g, '-').slice(0, 80));
  const png = await renderPng(card, `${base}.png`, item.kind === 'trade' ? { width: 1200, height: 675 } : { width: 1080, height: 1080 });
  let mp4 = null;
  if (item.notable) {
    const square = item.kind === 'trade' ? tradeHtml({ side: item.intent.side, symbol, image, lamports: item.lamports, pnlPct: item.pnlPct, signature: item.intent.signature, agent: item.agent }, { width: 1080, height: 1080 }) : card;
    try { mp4 = await renderMp4(square, `${base}.mp4`); } catch { mp4 = null; }
  }
  return { png, mp4, symbol };
}

const out = [];
for (const item of items) {
  const symbol = item.symbol ?? meta.get(item.mint)?.symbol;
  const text = item.kind === 'trade' ? postText(item.intent, symbol, cfg.site) : item.text(symbol, cfg.site);
  if (dryRun) {
    const row = { key: item.key, kind: item.kind, notable: !!item.notable, text };
    if (render) { try { const m = await media(item, previewDir); row.media = [m.png, m.mp4].filter(Boolean); } catch (e) { row.mediaError = String(e.message).slice(0, 80); } }
    out.push(row); continue;
  }
  const gate = postGate(ledger, cfg, now);
  if (gate !== 'ok') { out.push({ key: item.key, result: gate }); break; }
  const creds = await read('x-credentials.json', null);
  if (!validCreds(creds)) { out.push({ result: 'credentials-missing' }); break; }
  let mediaIds = [];
  try {
    await mkdir(join(root, 'x-media'), { recursive: true, mode: 0o700 });
    const m = await media(item, join(root, 'x-media'));
    const file = m.mp4 || m.png;
    const id = await uploadMedia(await readFile(file), m.mp4 ? 'video/mp4' : 'image/png', creds);
    if (id) mediaIds = [id];
  } catch {}
  const { status: code, id } = await sendPost(text, creds, fetch, mediaIds).catch(() => ({ status: 0, id: null }));
  if (code === 201 || code === 200) ledger.posted[item.key] = { at: now, outcome: 'posted', id, media: mediaIds.length > 0 };
  else if (code >= 400 && code < 500 && code !== 429) ledger.posted[item.key] = { at: now, outcome: `rejected-${code}` };
  out.push({ key: item.key, result: code, media: mediaIds.length > 0 });
  if (code === 429 || code === 0 || code >= 500) break; // retry next run
}
// Nothing real queued yet: render clearly-labelled samples so the look can be previewed.
if (render && items.length === 0) {
  const sig = 'SAMPLE' + '1'.repeat(82), size = { width: 1200, height: 675 };
  const files = [
    await renderPng(tradeHtml({ side: 'buy', symbol: 'SAMPLE', image: null, lamports: '50000000', pnlPct: null, signature: sig, agent: 'house' }), join(previewDir, 'sample-buy.png'), size),
    await renderPng(tradeHtml({ side: 'sell', symbol: 'SAMPLE', image: null, lamports: '81000000', pnlPct: 62, signature: sig, agent: 'house' }), join(previewDir, 'sample-sell.png'), size),
    await renderPng(recapHtml({ day: 'sample', trades: 0, winRate: null, solIn: 0, solOut: 0, burned: 0, workersOnline: Object.values(status).filter(w => w.online).length, workersTotal: Object.keys(status).length || 5 }), join(previewDir, 'sample-recap.png'), size),
    await renderMp4(tradeHtml({ side: 'sell', symbol: 'SAMPLE', image: null, lamports: '81000000', pnlPct: 62, signature: sig, agent: 'house' }, { width: 1080, height: 1080 }), join(previewDir, 'sample-sell.mp4')).catch(() => null),
  ].filter(Boolean);
  out.push({ samples: files });
}
if (!dryRun) await savePrivateJSON(join(root, 'x-posts.json'), ledger);
console.log(JSON.stringify({ dryRun, render, enabled: cfg.xPostsEnabled, pending: items.length, recapDay: previousUtcDay(now), out }, null, 1));
