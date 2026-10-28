import { hasStore, json, parse, redis } from './_lib.js'

// What he is doing this second: his latest actions and the time of the latest phone
// frame. Polled every few seconds while someone watches his phone, so it stays tiny
// and is cached at the edge for 2 seconds.
export async function GET() {
  if (!hasStore()) return json({ actions: [], screenTs: 0 }, 200, 2)
  const [list, ts] = await redis(['LRANGE', 'gg:actions', 0, 11], ['GET', 'gg:screen:ts'])
  const actions = ((list as string[]) ?? []).map((a) => parse<{ ts: number; text: string }>(a)).filter(Boolean)
  return json({ actions, screenTs: Number(ts ?? 0) }, 200, 2)
}
