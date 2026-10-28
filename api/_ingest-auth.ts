import { createHmac, timingSafeEqual } from 'node:crypto'

const same = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// A screen capability expires independently of the main ingestion credential.
// Rotate INGEST_TOKEN to revoke all capabilities. No wallet or trade scope.
export function ingestScope(authorization: string | null, secret: string, now = Date.now()): 'full' | 'screen' | null {
  if (!secret) return null
  const got = (authorization || '').replace(/^Bearer\s+/i, '')
  if (same(got, secret)) return 'full'
  const match = /^screen-v1\.(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(got)
  if (!match) return null
  const expires = Number(match[1]) * 1000
  if (expires <= now || expires > now + 7 * 86_400_000) return null
  const payload = `screen-v1.${match[1]}.${match[2]}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return same(signature, match[3]) ? 'screen' : null
}
