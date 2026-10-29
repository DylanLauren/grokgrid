// Posts display events to the site's /api/ingest with the full ingest token.
// Best effort: a failed post never changes a worker's outcome. Never posts secrets.
import { join } from 'node:path';
import { readPrivateText } from './runtime-observation-store.mjs';

const ORIGIN = 'https://grokgrid-alpha.vercel.app';
const WORKERS = ['trading', 'buyback', 'strategy', 'agent-runner', 'phone'];
const MODES = ['observe-only', 'paper', 'execute'];
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/api-key=[^&\s]+/gi, '').trim().slice(0, max);

export async function postIngest(root, event, fetchImpl = fetch) {
  if (process.env.GROKGRID_INGEST === 'off') return false; // tests and dry runs
  try {
    const cfg = JSON.parse(await readPrivateText(join(root, 'observer-config.json')));
    const token = (await readPrivateText(cfg.tokenFile)).trim();
    const r = await fetchImpl(`${ORIGIN}/api/ingest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(event), redirect: 'error', signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
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
