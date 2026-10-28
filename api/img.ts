import { hasStore, isAddress, parse, redis } from './_lib.js'

// A grid bot's coin picture, served at /i/<mint>.
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get('mint')
  if (!isAddress(mint) || !hasStore()) return new Response('not found', { status: 404 })
  const [raw] = await redis(['GET', `gg:img:${mint}`])
  const img = parse<{ type: string; b64: string }>(raw)
  if (!img || !/^image\/(png|jpeg|gif|webp)$/.test(img.type)) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, s-maxage=30' } })
  return new Response(Buffer.from(img.b64, 'base64'), {
    headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=300, s-maxage=86400', 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' },
  })
}
