// Pure policy and one-frame pipeline. No capture or network side effects at import.
export const PHONE_ORIGINS = ['https://grokgrid-alpha.vercel.app', 'https://www.grokgrid.fun']
export function capabilityExpiry(token, now = Date.now()) {
  const match = /^screen-v1\.(\d{10})\.[a-f0-9]{32}\.[a-f0-9]{64}$/.exec(token)
  const expiry = Number(match?.[1]) * 1000
  if (!match || expiry <= now + 15_000 || expiry > now + 7 * 86_400_000) throw Error('screen-credential-invalid-or-expiring')
  return expiry
}
export function validateConfig(input) {
  if (!input || input.source !== 'grok-bot-actual-window') throw Error('actual-bot-window-required')
  for (const key of ['windowId', 'ownerPid']) if (!Number.isSafeInteger(input[key]) || input[key] <= 0) throw Error('window-identity-required')
  for (const key of ['bundleId', 'title', 'tokenFile', 'statusFile']) if (typeof input[key] !== 'string' || !input[key].trim()) throw Error('configuration-incomplete')
  for (const key of ['tokenFile', 'statusFile']) if (!input[key].startsWith('/')) throw Error('absolute-path-required')
  if (input.tokenFile === input.statusFile) throw Error('paths-must-differ')
  const site = input.site || PHONE_ORIGINS[0]
  if (!PHONE_ORIGINS.includes(site)) throw Error('site-not-allowed')
  const everyMs = input.everyMs ?? 2500
  if (!Number.isInteger(everyMs) || everyMs < 2000 || everyMs > 60_000) throw Error('interval-invalid')
  if (input.bundleId === 'com.google.Chrome') {
    let url
    try { url = new URL(input.browserUrl) } catch { throw Error('browser-url-required') }
    if (url.origin !== 'https://pump.fun' || url.username || url.password || url.hash) throw Error('browser-url-invalid')
  }
  return { ...input, site, everyMs }
}
export function verifyWindow(snapshot, config) {
  if (!snapshot || snapshot.id !== config.windowId || snapshot.pid !== config.ownerPid || snapshot.bundleId !== config.bundleId || snapshot.title !== config.title || snapshot.onScreen !== true || snapshot.layer !== 0) throw Error('window-identity-mismatch')
  const b = snapshot.bounds
  if (!b || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) || b.width < 250 || b.height < 400 || b.width / b.height < .35 || b.width / b.height > .85) throw Error('phone-window-geometry-invalid')
  if (config.bundleId === 'com.google.Chrome' && snapshot.browserUrl !== config.browserUrl) throw Error('browser-url-mismatch')
  return snapshot
}
export function sameWindow(a, b) {
  return ['id', 'pid', 'bundleId', 'title', 'onScreen', 'layer', 'browserUrl'].every(k => a[k] === b[k]) && ['x', 'y', 'width', 'height'].every(k => a.bounds[k] === b.bounds[k])
}
export function validateJpeg(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > 330_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw Error('capture-invalid')
}
export async function captureAndSend(config, deps) {
  capabilityExpiry(deps.token, deps.now())
  const before = verifyWindow(await deps.inspect(), config)
  const bytes = await deps.capture()
  validateJpeg(bytes)
  const after = verifyWindow(await deps.inspect(), config)
  if (!sameWindow(before, after)) throw Error('window-changed-during-capture')
  capabilityExpiry(deps.token, deps.now())
  await deps.send(bytes)
  return { capturedAt: deps.now(), bytes: bytes.length }
}
export function retryPolicy(failures, code) {
  if (['credential-rejected', 'screen-credential-invalid-or-expiring', 'request-rejected'].includes(code) || failures >= 8) return { stop: true, delayMs: 0 }
  return { stop: false, delayMs: Math.min(60_000, 2000 * 2 ** Math.max(0, failures - 1)) }
}
export function safeFailure(error) {
  const allowed = ['screen-credential-invalid-or-expiring', 'window-identity-mismatch', 'phone-window-geometry-invalid', 'browser-url-mismatch', 'window-changed-during-capture', 'capture-invalid', 'credential-rejected', 'request-rejected', 'ingest-unavailable', 'capture-unavailable']
  return allowed.includes(error?.message) ? error.message : 'feed-unavailable'
}
