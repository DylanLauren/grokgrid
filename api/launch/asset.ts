// Stores a coin's picture before launch, under the mint address the browser just made.
// First upload wins, so nobody can swap a picture once it is in. Served from /i/<mint>.
import { hasStore, isAddress, redis } from '../_lib.js'
import { DRAFT_TTL, MAX_IMAGE_BYTES, SITE_URL, keys, launchStatus, limited, noStore, readJson } from '../_launch.js'
import { verifiedWalletId } from '../_wallet-auth.js'

// Only a signed-in launcher with a verified agent wallet can upload, and each wallet gets a
// few pictures a day. Unlaunched pictures expire after DRAFT_TTL, so the store stays bounded
// and nobody can use up a shared cap to block other people's launches.
const PER_WALLET_DAY = 10

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'asset', 5)
  if (slow) return slow
  const status = await launchStatus()
  if (!status.open) return noStore({ error: status.reason ?? 'Launching is paused right now.' }, 503)
  const b = await readJson<{ mint?: unknown; image?: unknown; launcher?: unknown; bot?: unknown; walletId?: unknown }>(req, 600_000)
  if (!b) return noStore({ error: 'Image must be 400 KB or smaller.' }, 413)
  if (!isAddress(b.mint) || !isAddress(b.launcher) || typeof b.image !== 'string') return noStore({ error: 'bad request' }, 400)
  const m = b.image.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!m) return noStore({ error: 'Use a PNG, JPG, GIF or WebP image.' }, 400)
  const data = Buffer.from(m[2], 'base64')
  if (data.length > MAX_IMAGE_BYTES) return noStore({ error: 'Image must be 400 KB or smaller.' }, 413)
  // the bytes must really be the image type they claim
  const magic = data.subarray(0, 12).toString('hex')
  const kind = magic.startsWith('89504e47') ? 'image/png' : magic.startsWith('ffd8ff') ? 'image/jpeg' : magic.startsWith('47494638') ? 'image/gif' : magic.startsWith('52494646') && magic.slice(16, 24) === '57454250' ? 'image/webp' : null
  if (!kind) return noStore({ error: "That file isn't an image." }, 400)
  if (b.bot !== undefined && !isAddress(b.bot)) return noStore({ error: 'bad request' }, 400)
  // the signed-in owner of the bot wallet (which may differ from the launching wallet)
  if (!(await verifiedWalletId(req, b.walletId, (b.bot as string | undefined) ?? b.launcher))) return noStore({ error: 'Set up and verify your agent wallet first.' }, 403)
  const mine = `gg:lim:asset-wallet:${b.launcher}:${Math.floor(Date.now() / 86_400_000)}`
  const [own] = await redis(['INCR', mine], ['EXPIRE', mine, 172_800])
  if (Number(own) > PER_WALLET_DAY) return noStore({ error: 'Too many pictures from this wallet today. Try again tomorrow.' }, 429)
  const [ok] = await redis(['SET', keys.image(b.mint), JSON.stringify({ type: kind, b64: m[2] }), 'NX', 'EX', DRAFT_TTL])
  if (ok !== 'OK') return noStore({ error: 'That coin address is taken. Try again for a fresh one.' }, 409)
  return noStore({ image: `${SITE_URL}/i/${b.mint}` })
}
