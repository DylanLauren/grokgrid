import { redis } from './_lib.js'

// Mac workers report their health here through /api/ingest {type:'runtime'}.
// Launches open only while the agent runner says it is executing and healthy,
// and only if LAUNCHES_ENABLED=1 is set in Vercel (the operator's own switch).

export const WORKERS = ['trading', 'buyback', 'strategy', 'agent-runner', 'phone'] as const
export type Worker = (typeof WORKERS)[number]
export const MODES = ['observe-only', 'paper', 'execute'] as const
export type Mode = (typeof MODES)[number]
export interface Beat { worker: Worker; mode: Mode; healthy: boolean; agents: number | null; note: string; ts: number }

export const STALE_MS = 120_000
const key = (w: Worker) => `gg:runtime:${w}`

export function readBeat(ev: Record<string, unknown>, now = Date.now()): Beat | null {
  const worker = WORKERS.find((w) => w === ev.worker)
  const mode = MODES.find((m) => m === ev.mode)
  if (!worker || !mode || typeof ev.healthy !== 'boolean') return null
  const agents = typeof ev.agents === 'number' && Number.isSafeInteger(ev.agents) && ev.agents >= 0 && ev.agents < 1e6 ? ev.agents : null
  const note = typeof ev.note === 'string' ? ev.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : ''
  return { worker, mode, healthy: ev.healthy, agents, note, ts: now }
}

export const saveBeat = (b: Beat) => redis(['SET', key(b.worker), JSON.stringify(b), 'EX', Math.ceil((STALE_MS * 3) / 1000)])

export async function beats(): Promise<Partial<Record<Worker, Beat>>> {
  const raw = await redis(...WORKERS.map((w) => ['GET', key(w)]))
  const out: Partial<Record<Worker, Beat>> = {}
  raw.forEach((r, i) => {
    try {
      if (typeof r === 'string') out[WORKERS[i]] = JSON.parse(r) as Beat
    } catch {
      /* a bad record reads as missing */
    }
  })
  return out
}

export const fresh = (b: Beat | undefined, now = Date.now()): b is Beat => !!b && b.healthy && now - b.ts <= STALE_MS && b.ts <= now + 5_000

// Real execution only: paper mode never opens real launches.
export function runnerReady(all: Partial<Record<Worker, Beat>>, enabled: string | undefined, now = Date.now()) {
  const r = all['agent-runner']
  return enabled === '1' && fresh(r, now) && r.mode === 'execute'
}
