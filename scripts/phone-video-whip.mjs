// A localhost signaling bridge keeps the provider publish URL out of ffmpeg argv.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { validateWhipUrl } from './phone-video-core.mjs'
export async function createWhipProxy(remoteUrl, { fetchImpl = fetch, onEvent = () => {} } = {}) {
  const target = validateWhipUrl(remoteUrl), base = new URL(target)
  const route = '/' + randomUUID(), sessions = new Map()
  const server = createServer(async (req, res) => {
    try {
      const method = req.method
      const entry = sessions.get(req.url)
      const remote = req.url === route && method === 'POST' ? target : ['DELETE','PATCH'].includes(method) ? entry?.url : null
      if (!remote) { res.writeHead(404).end(); return }
      const parts = []; let size = 0
      for await (const part of req) { size += part.length; if (size > 1000000) throw Error('body-limit'); parts.push(part) }
      const headers = {}
      for (const k of ['content-type','accept','if-match']) if (typeof req.headers[k] === 'string') headers[k] = req.headers[k]
      const response = await fetchImpl(remote, { method, headers, body: size ? Buffer.concat(parts) : undefined, redirect: 'manual', signal: AbortSignal.timeout(10000) })
      onEvent({ event:'upstream-response', method, status:response.status })
      if (response.status >= 300 && response.status < 400) throw Error('redirect-blocked')
      const out = { 'cache-control': 'no-store' }
      for (const k of ['content-type','etag','accept-patch']) if (response.headers.get(k)) out[k] = response.headers.get(k)
      const location = response.headers.get('location')
      if (location) {
        const session = new URL(location, remote)
        if (session.origin !== base.origin || session.username || session.password || session.hash) throw Error('session-origin-invalid')
        const local = '/' + randomUUID(); sessions.set(local, {url: session.href, etag: response.headers.get('etag')}); out.location = local
      }
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length > 1000000) throw Error('response-limit')
      res.writeHead(response.status, out).end(body)
      if (method === 'DELETE' && (response.ok || response.status === 404 || response.status === 410)) sessions.delete(req.url)
      else if (entry && response.headers.get('etag')) entry.etag = response.headers.get('etag')
    } catch (error) {
      onEvent({event:'signaling-error',reason:['body-limit','redirect-blocked','session-origin-invalid','response-limit'].includes(error?.message)?error.message:'upstream-unavailable'})
      if (!res.headersSent) res.writeHead(502); res.end()
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}${route}`, close: async () => {
    // A killed encoder might not have sent its WHIP DELETE. End only resources
    // created by this bridge; use the private mapped URL and original ETag.
    await Promise.allSettled([...sessions.values()].map(entry => fetchImpl(entry.url, {method:'DELETE',headers:entry.etag ? {'if-match':entry.etag} : {},redirect:'manual',signal:AbortSignal.timeout(3000)})))
    sessions.clear()
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
  } }
}
