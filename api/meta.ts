import { hasStore, isAddress, redis } from './_lib.js'

// Token metadata (name, picture, links) that pump.fun, wallets and explorers read, at /m/<mint>.
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get('mint')
  if (!isAddress(mint) || !hasStore()) return new Response('not found', { status: 404 })
  const [meta] = await redis(['GET', `gg:meta:${mint}`])
  if (typeof meta !== 'string') return new Response('not found', { status: 404, headers: { 'Cache-Control': 'public, s-maxage=30' } })
  return new Response(meta, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=3600', 'Access-Control-Allow-Origin': '*' } })
}
