import { createHash, randomUUID } from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'

export const PHONE_ROOM = 'grokgrid-house'
// LiveKit WHIP without transcoding assigns this name to the incoming video.
// The configured ingress label is not the published track name.
export const PHONE_TRACK = 'synthesized-camera'
const HEADERS = { 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin', Vary: 'Origin, Sec-Fetch-Site' }
const LIMIT_SCRIPT = `local a=redis.call('INCR',KEYS[1]); if a==1 then redis.call('EXPIRE',KEYS[1],120) end; local b=redis.call('INCR',KEYS[2]); if b==1 then redis.call('EXPIRE',KEYS[2],120) end; return {a,b}`
type Dependencies = {
  env: () => Record<string, string | undefined>
  hasStore: () => boolean
  redis: (...commands: (string | number)[][]) => Promise<unknown[]>
  now?: () => number
}

// Redis provides a deployment-wide limit when configured. The bounded memory
// fallback is per instance only; it is not a replacement for a platform WAF.
export function phoneSessionHandler(deps: Dependencies) {
  const local = new Map<string, number>()
  let localBucket = -1
  return async (req: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200, extra = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } })
    if (req.method !== 'GET') return reply({ error: 'Method not allowed' }, 405, { Allow: 'GET' })
    const origin = req.headers.get('origin')
    const site = req.headers.get('sec-fetch-site')
    if ((origin && origin !== new URL(req.url).origin) || (site && site !== 'same-origin' && site !== 'none')) return reply({ error: 'Cross-origin request denied' }, 403)
    const env = deps.env()
    const key = env.LIVEKIT_API_KEY?.trim()
    const secret = env.LIVEKIT_API_SECRET?.trim()
    let url: URL
    try {
      url = new URL(env.LIVEKIT_URL || '')
      if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('configuration')
    } catch { return reply({ error: 'Phone video unavailable' }, 503) }
    if (!key || !secret) return reply({ error: 'Phone video unavailable' }, 503)
    try {
      const bucket = Math.floor((deps.now?.() ?? Date.now()) / 60000)
      const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 64)
      const hash = createHash('sha256').update(ip).digest('hex').slice(0, 24)
      let own: number, total: number
      if (deps.hasStore()) {
        const [counts] = await deps.redis(['EVAL', LIMIT_SCRIPT, 2, `gg:phone:session:${bucket}:${hash}`, `gg:phone:session:${bucket}:all`])
        if (!Array.isArray(counts) || counts.length !== 2 || !counts.every(n => Number.isSafeInteger(n) && n > 0)) throw Error('limiter')
        ;[own, total] = counts as number[]
      } else {
        if (bucket !== localBucket) { local.clear(); localBucket = bucket }
        total = (local.get('all') ?? 0) + 1
        local.set('all', total)
        // Bound cardinality even under changing client addresses.
        if (total > 300) return reply({ error: 'Too many viewing requests' }, 429, { 'Retry-After': '60' })
        own = (local.get(hash) ?? 0) + 1
        local.set(hash, own)
      }
      if (own > 12 || total > 300) return reply({ error: 'Too many viewing requests' }, 429, { 'Retry-After': '60' })
      const token = new AccessToken(key, secret, { identity: `viewer-${randomUUID()}`, ttl: 600 })
      token.addGrant({ room: PHONE_ROOM, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false, roomAdmin: false, roomCreate: false, roomList: false, roomRecord: false, ingressAdmin: false })
      return reply({ url: url.origin, token: await token.toJwt(), room: PHONE_ROOM, trackName: PHONE_TRACK })
    } catch {
      // Never return SDK/provider errors that might contain credentials.
      return reply({ error: 'Phone video unavailable' }, 503)
    }
  }
}
