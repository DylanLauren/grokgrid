// A localhost signaling bridge keeps the provider publish URL out of ffmpeg argv.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { validateWhipUrl } from './phone-video-core.mjs'
// ffmpeg's WHIP muxer rejects TCP ICE candidates instead of ignoring them.
// Remove only those candidates when this media/BUNDLE transport has UDP.
export function udpCompatibleSdp(body) {
  const text=body.toString('utf8'), lines=text.split(/\r?\n/), candidates=[], mids=new Map(), bundles=[]
  let section=-1
  for (let index=0;index<lines.length;index++) {
    const line=lines[index]
    if (line.startsWith('m=')) section++
    const mid=/^a=mid:(\S+)$/.exec(line); if(mid)mids.set(section,mid[1])
    const bundle=/^a=group:BUNDLE\s+(.+)$/.exec(line);if(bundle)bundles.push(new Set(bundle[1].trim().split(/\s+/)))
    const c=/^a=candidate:\S+\s+(\d+)\s+(udp|tcp)\s+\d+\s+(\S+)\s+(\d+)\s+typ\s+\S+(?:\s.*)?$/i.exec(line)
    if(c)candidates.push({index,section,component:Number(c[1]),transport:c[2].toLowerCase(),host:c[3],port:Number(c[4])})
  }
  const tcp=candidates.filter(c=>c.transport==='tcp')
  if(!tcp.length)return {body,removed:0}
  const udp=candidates.filter(c=>c.transport==='udp' && c.port>0 && c.port<=65535 && !['0.0.0.0','::'].includes(c.host))
  const sharesTransport=(a,b)=>a.section===b.section || a.section===-1 || b.section===-1 || bundles.some(group=>group.has(mids.get(a.section))&&group.has(mids.get(b.section)))
  if(tcp.some(candidate=>!udp.some(other=>other.component===candidate.component&&sharesTransport(candidate,other))))throw Error('udp-candidate-required')
  const remove=new Set(tcp.map(c=>c.index))
  return {body:Buffer.from(lines.filter((_,i)=>!remove.has(i)).join(text.includes('\r\n')?'\r\n':'\n')),removed:tcp.length}
}
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
      let body = Buffer.from(await response.arrayBuffer())
      if (body.length > 1000000) throw Error('response-limit')
      if(method==='POST' && response.ok && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/sdp') {
        const compatible=udpCompatibleSdp(body);body=compatible.body
        if(compatible.removed)onEvent({event:'unsupported-tcp-candidates-removed',count:compatible.removed})
      }
      res.writeHead(response.status, out).end(body)
      if (method === 'DELETE' && (response.ok || response.status === 404 || response.status === 410)) sessions.delete(req.url)
      else if (entry && response.headers.get('etag')) entry.etag = response.headers.get('etag')
    } catch (error) {
      onEvent({event:'signaling-error',reason:['body-limit','redirect-blocked','session-origin-invalid','response-limit','udp-candidate-required'].includes(error?.message)?error.message:'upstream-unavailable'})
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
