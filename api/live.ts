import { hasStore, parse, redis } from './_lib.js'

// What he is doing this second: his latest actions and the time of the latest phone
// frame. Polled every few seconds while someone watches his phone, so it stays tiny
// and must not advertise an edge-cached frame as current.
export async function GET() {
  if (!hasStore()) return Response.json({ actions: [], screenTs: 0 }, { headers: { 'Cache-Control': 'no-store' } })
  const [list, ts] = await redis(['LRANGE', 'gg:actions', 0, 11], ['GET', 'gg:screen:ts'])
  const actions = ((list as string[]) ?? []).map((a) => parse<{ ts: number; text: string }>(a)).filter(Boolean)
  return Response.json({ actions, screenTs: Number(ts ?? 0) }, { headers: { 'Cache-Control': 'no-store' } })
}
