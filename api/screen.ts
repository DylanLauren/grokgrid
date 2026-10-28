import { hasStore, redis } from './_lib.js'

// His latest phone frame as a JPEG. The page asks for /api/screen?t=<frame time>, so
// every frame has its own URL and the edge can keep it.
export async function GET() {
  const [jpeg] = hasStore() ? await redis(['GET', 'gg:screen']) : [null]
  if (typeof jpeg !== 'string') return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new Response(Buffer.from(jpeg, 'base64'), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=60, s-maxage=60' },
  })
}
