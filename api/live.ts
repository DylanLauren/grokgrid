import { EDGE_1S, hasStore, parse, redis, readLimited } from './_lib.js'

// What he is doing this second: his latest actions and the time of the latest phone
// frame. Polled every few seconds by every viewer, so the CDN answers repeats for one
// second; that keeps Redis load flat however many people watch.
export async function GET(req?: Request) {
  const slow = await readLimited(req, 'live')
  if (slow) return slow
  if (!hasStore()) return Response.json({ actions: [], screenTs: 0 }, { headers: { 'Cache-Control': 'no-store' } })
  const [list, ts] = await redis(['LRANGE', 'gg:actions', 0, 11], ['GET', 'gg:screen:ts'])
  const actions = ((list as string[]) ?? []).map((a) => parse<{ ts: number; text: string }>(a)).filter(Boolean)
  return Response.json({ actions, screenTs: Number(ts ?? 0) }, { headers: { 'Cache-Control': EDGE_1S } })
}
