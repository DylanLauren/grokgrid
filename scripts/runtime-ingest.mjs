// Posts display events to the site's /api/ingest with the full ingest token.
// Best effort: a failed post never changes a worker's outcome. Never posts secrets.
import { join } from 'node:path';
import { readPrivateText } from './runtime-observation-store.mjs';

const ORIGIN = 'https://grokgrid-alpha.vercel.app';
const WORKERS = ['trading', 'buyback', 'strategy', 'agent-runner', 'phone'];
const MODES = ['observe-only', 'paper', 'execute'];
// eslint-disable-next-line no-control-regex -- strip control characters from outgoing text
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/api-key=[^&\s]+/gi, '').trim().slice(0, max);

async function postIngest(root, event, fetchImpl = fetch) {
  if (process.env.GROKGRID_INGEST === 'off') return false; // tests and dry runs
  try {
    const cfg = JSON.parse(await readPrivateText(join(root, 'observer-config.json')));
    const token = (await readPrivateText(cfg.tokenFile)).trim();
    const r = await fetchImpl(`${ORIGIN}/api/ingest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(event), redirect: 'error', signal: AbortSignal.timeout(8000) });
    return event.type === 'trade' ? r.status : r.ok;
  } catch { return event.type === 'trade' ? 0 : false; }
}

/** Heartbeat the site reads; stale after 120s. */
export function heartbeat(root, worker, { mode, healthy, agents, note } = {}, fetchImpl) {
  if (!WORKERS.includes(worker) || !MODES.includes(mode)) return Promise.resolve(false);
  const event = { type: 'runtime', worker, mode, healthy: healthy === true };
  if (Number.isSafeInteger(agents) && agents >= 0) event.agents = agents;
  if (note) event.note = clean(note, 80);
  return postIngest(root, event, fetchImpl);
}

/** One line for the site's live "what he's doing" feed. */
export const action = (root, text, fetchImpl) => postIngest(root, { type: 'action', text: clean(text, 120) }, fetchImpl);

/**
 * A reconciled trade, as a callout. The site re-verifies the signature on chain and
 * dedupes by signature. Returns the HTTP status (0 when unreachable).
 */
export function postTrade(root, { agent, side, mint, sig, symbol, name, image, note }, fetchImpl) {
  const event = { type: 'trade', agent, side, mint, sig };
  if (symbol) event.symbol = clean(symbol, 16);
  if (name) event.name = clean(name, 48);
  if (typeof image === 'string' && image.startsWith('https://')) event.image = image;
  if (note) event.note = clean(note, 280);
  return postIngest(root, event, fetchImpl);
}

/**
 * The phone helper runs from its own app bundle, so its beat is derived here from the
 * feed's private status file: healthy only while frames were sent in the last minute.
 */
export async function phoneHeartbeat(root, now = Date.now(), fetchImpl) {
  let s = null;
  try { s = JSON.parse(await readPrivateText(join(root, 'local-phone-status.json'), 16384)); } catch {}
  return heartbeat(root, 'phone', phoneBeat(s, now), fetchImpl);
}

export function phoneBeat(s, now) {
  const sent = Date.parse(s?.lastSentAt ?? '');
  const healthy = s?.state === 'sending' && Number.isFinite(sent) && sent <= now + 5000 && now - sent < 60000;
  return { mode: 'observe-only', healthy, note: healthy ? 'live' : String(s?.state || 'unknown').slice(0, 40) };
}
