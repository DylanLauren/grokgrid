#!/usr/bin/env node
// Posts each real house trade to X once. --dry-run prints what it would post and sends nothing.
// Off unless x-config.json sets xPostsEnabled; needs x-credentials.json (0600) from dlao's X app.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readPrivateText, savePrivateJSON } from './runtime-observation-store.mjs';
import { DEFAULT_X, pendingPosts, postText, postGate, sendPost, validCreds } from './x-posts.mjs';
import { marketMetrics } from './strategy-data.mjs';
import { heartbeat } from './runtime-ingest.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
if (args.some(a => !['--once', '--dry-run'].includes(a))) { console.error('Usage: x-post-worker.mjs [--once] [--dry-run]'); process.exit(1); }
const read = async (name, fallback) => { try { return JSON.parse(await readPrivateText(join(root, name))); } catch { return fallback; } };

const cfg = { ...DEFAULT_X, ...(await read('x-config.json', {})) };
const ledger = await read('x-posts.json', { version: 1, posted: {} });
const journal = await read('trading/trading-journal.json', null);
const todo = pendingPosts(journal?.state, ledger).slice(0, 3);
const now = Date.now();
let meta = new Map(); try { if (todo.length) meta = await marketMetrics([...new Set(todo.map(i => i.mint))]); } catch {}
const out = [];
for (const i of todo) {
  const text = postText(i, meta.get(i.mint)?.symbol, cfg.site);
  if (dryRun) { out.push({ signature: i.signature, text }); continue; }
  const gate = postGate(ledger, cfg, now);
  if (gate !== 'ok') { out.push({ signature: i.signature, result: gate }); break; }
  const creds = await read('x-credentials.json', null);
  if (!validCreds(creds)) { out.push({ result: 'credentials-missing' }); break; }
  const { status, id } = await sendPost(text, creds).catch(() => ({ status: 0, id: null }));
  if (status === 201 || status === 200) ledger.posted[i.signature] = { at: now, outcome: 'posted', id };
  else if (status >= 400 && status < 500 && status !== 429) ledger.posted[i.signature] = { at: now, outcome: `rejected-${status}` };
  out.push({ signature: i.signature, result: status });
  if (status === 429 || status === 0 || status >= 500) break; // retry next run
}
if (!dryRun) await savePrivateJSON(join(root, 'x-posts.json'), ledger);
console.log(JSON.stringify({ dryRun, enabled: cfg.xPostsEnabled, pending: todo.length, out }));
