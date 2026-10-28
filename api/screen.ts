import { EDGE_1S, hasStore, redis } from './_lib.js'

// Read the frame and its identity atomically. Every viewer polls this, so the CDN
// shares a successful response for one second. Origin reads reject frames aged
// 12 seconds or more; errors are never cached.
export async function GET(req: Request) {
  const [pair] = hasStore() ? await redis(['MGET', 'gg:screen', 'gg:screen:ts']) : [null]
  const [jpeg, timestamp] = Array.isArray(pair) ? pair : [null, null]
  const ts = Number(timestamp)
  const requested = new URL(req.url).searchParams.get('t')
  const age = Date.now() - ts
  if (typeof jpeg !== 'string' || !Number.isSafeInteger(ts) || ts <= 0 || age < 0 || age >= 12_000 || (requested !== null && requested !== String(ts))) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return new Response(Buffer.from(jpeg, 'base64'), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': EDGE_1S, 'X-Frame-Timestamp': String(ts), 'X-Content-Type-Options': 'nosniff' },
  })
}
