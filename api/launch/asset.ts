// Stores a coin's picture before launch, under the mint address the browser just made.
// First upload wins, so nobody can swap a picture once it is in. Served from /i/<mint>.
import { hasStore, isAddress, redis } from '../_lib.js'
import { DRAFT_TTL, MAX_IMAGE_BYTES, SITE_URL, keys, limited, noStore, readJson } from '../_launch.js'

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'asset', 20)
  if (slow) return slow
  const b = await readJson<{ mint?: unknown; image?: unknown }>(req, 600_000)
  if (!b) return noStore({ error: 'Image must be 400 KB or smaller.' }, 413)
  if (!isAddress(b.mint) || typeof b.image !== 'string') return noStore({ error: 'bad request' }, 400)
  const m = b.image.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!m) return noStore({ error: 'Use a PNG, JPG, GIF or WebP image.' }, 400)
  const data = Buffer.from(m[2], 'base64')
  if (data.length > MAX_IMAGE_BYTES) return noStore({ error: 'Image must be 400 KB or smaller.' }, 413)
  // the bytes must really be the image type they claim
  const magic = data.subarray(0, 12).toString('hex')
  const kind = magic.startsWith('89504e47') ? 'image/png' : magic.startsWith('ffd8ff') ? 'image/jpeg' : magic.startsWith('47494638') ? 'image/gif' : magic.startsWith('52494646') && magic.slice(16, 24) === '57454250' ? 'image/webp' : null
  if (!kind) return noStore({ error: "That file isn't an image." }, 400)
  const [ok] = await redis(['SET', keys.image(b.mint), JSON.stringify({ type: kind, b64: m[2] }), 'NX', 'EX', DRAFT_TTL])
  if (ok !== 'OK') return noStore({ error: 'That coin address is taken. Try again for a fresh one.' }, 409)
  return noStore({ image: `${SITE_URL}/i/${b.mint}` })
}
