#!/usr/bin/env node
// Capture only an explicitly pinned bot-owned macOS window. --check never captures/uploads.
import { execFile } from 'node:child_process'
import { readFile, writeFile, mkdir, mkdtemp, rm, lstat, open, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { capabilityExpiry, validateConfig, verifyWindow, browserViewportCrop, encodePhoneCapture, captureAndSend, captureFailureState, safeFailure } from './phone-feed-core.mjs'
const run = promisify(execFile)
const args = process.argv.slice(2)
const help = 'Usage: node scripts/phone-feed.mjs --config /absolute/private/config.json [--check | --once]. Requires a screen-only token and pinned actual bot window; rectangle capture is unsupported.'
if (args.includes('--help')) { console.log(help); process.exit(0) }
process.umask(0o077)
let stop = false
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop = true })
const sleep = ms => new Promise(resolve => { const start = Date.now(); const timer = setInterval(() => { if (stop || Date.now() - start >= ms) { clearInterval(timer); resolve() } }, 100) })
async function privateFile(path) {
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = await h.stat()
    if (!s.isFile() || s.nlink !== 1 || s.size > 65536 || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw Error('private-file-required')
    return await h.readFile('utf8')
  } finally { await h.close() }
}
async function main() {
  if (process.platform !== 'darwin') throw Error('macos-required')
  const ix = args.indexOf('--config')
  if (ix < 0 || !args[ix + 1]?.startsWith('/') || args.some((v, i) => !['--config', '--once', '--check'].includes(v) && i !== ix + 1)) throw Error('configuration-required')
  if (args.includes('--once') && args.includes('--check')) throw Error('choose-check-or-once')
  const config = validateConfig(JSON.parse(await privateFile(args[ix + 1])))
  let token = (await privateFile(config.tokenFile)).trim()
  let expiresAt = null
  const swift = fileURLToPath(new URL('./phone-window.swift', import.meta.url))
  async function inspect() {
    try {
      const { stdout } = await run('/usr/bin/swift', [swift, String(config.windowId)], { timeout: 15_000, maxBuffer: 16_384 })
      const snapshot = JSON.parse(stdout)
      if (snapshot && config.bundleId === 'com.google.Chrome') {
        // Find the selected Chrome window by matching its exact title and bounds.
        // Never activate, navigate, or read unrelated tab contents.
        const pageMetrics = 'JSON.stringify({innerWidth:window.innerWidth,innerHeight:window.innerHeight,outerWidth:window.outerWidth,outerHeight:window.outerHeight,devicePixelRatio:window.devicePixelRatio,href:window.location.href})'
        const js = `const app=Application('Google Chrome'); const windows=app.windows(); const matches=windows.filter(w=>{const b=w.bounds();return w.name()===${JSON.stringify(config.title)}&&Math.abs(b.x-${snapshot.bounds.x})<2&&Math.abs(b.y-${snapshot.bounds.y})<2&&Math.abs(b.width-${snapshot.bounds.width})<2&&Math.abs(b.height-${snapshot.bounds.height})<2}); if(matches.length!==1){JSON.stringify({browserUrl:'',viewport:null})}else{const tab=matches[0].activeTab();JSON.stringify({browserUrl:tab.url(),viewport:${snapshot.onScreen === true ? `JSON.parse(tab.execute({javascript:${JSON.stringify(pageMetrics)}}))` : 'null'}})}`
        const details = JSON.parse((await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', js], { timeout: 5000, maxBuffer: 8192 })).stdout.trim())
        snapshot.browserUrl = details.browserUrl
        snapshot.viewport = details.viewport
      }
      return snapshot
    } catch { throw Error('capture-unavailable') }
  }
  if (args.includes('--check')) {
    expiresAt = capabilityExpiry(token)
    verifyWindow(await inspect(), config)
    console.log(JSON.stringify({ state: 'window-check-passed', publishing: false, credentialExpiresAt: new Date(expiresAt).toISOString() }))
    return
  }
  const folder = dirname(config.statusFile)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const folderInfo = await lstat(folder)
  if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink() || (folderInfo.mode & 0o077) || (process.getuid && folderInfo.uid !== process.getuid())) throw Error('private-status-directory-required')
  const lock = config.statusFile + '.lock'
  const handle = await open(lock, 'wx', 0o600)
  await handle.writeFile(String(process.pid)); await handle.close()
  const parentPid = process.ppid
  const parentWatch = parentPid > 1 ? setInterval(() => { if (process.ppid !== parentPid) stop = true }, 1000) : null
  parentWatch?.unref()
  let temp, failures = 0, lastSentAt = null, lastFailureReason = null
  const status = async (state, extra = {}) => {
    const dest = config.statusFile + '.tmp'
    await writeFile(dest, JSON.stringify({ version: 1, state, observedAt: new Date().toISOString(), lastSentAt, windowId: config.windowId, credentialExpiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(), failures, ...extra }) + '\n', { mode: 0o600 })
    await rename(dest, config.statusFile)
  }
  try {
    temp = await mkdtemp(join(tmpdir(), 'grokgrid-phone-'))
    const raw = join(temp, 'frame.png')
    const shot = join(temp, 'frame.jpg')
    const page = join(temp, 'page.png')
    const padded = join(temp, 'padded.png')
    async function capture(snapshot) {
      try {
        await run('/usr/sbin/screencapture', ['-x', '-o', '-t', 'png', '-l', String(config.windowId), raw], { timeout: 8000, maxBuffer: 4096 })
        const { stdout } = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', raw], { timeout: 5000, maxBuffer: 4096 })
        const sourceWidth = Number(/^\s*pixelWidth:\s*(\d+)\s*$/m.exec(stdout)?.[1])
        const sourceHeight = Number(/^\s*pixelHeight:\s*(\d+)\s*$/m.exec(stdout)?.[1])
        let content = raw
        if (config.bundleId === 'com.google.Chrome') {
          const crop = browserViewportCrop(snapshot, sourceWidth, sourceHeight)
          // sips silently skips crops touching the bottom boundary. Pad one row on
          // each end, then discard both padding rows with the verified crop.
          await run('/usr/bin/sips', ['--padToHeightWidth', String(sourceHeight + 2), String(sourceWidth), raw, '--out', padded], { timeout: 5000, maxBuffer: 4096 })
          await run('/usr/bin/sips', ['--cropToHeightWidth', String(crop.height), String(crop.width), '--cropOffset', String(crop.top + 1), String(crop.left), padded, '--out', page], { timeout: 5000, maxBuffer: 4096 })
          const measured = (await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', page], { timeout: 5000, maxBuffer: 4096 })).stdout
          if (Number(/^\s*pixelWidth:\s*(\d+)\s*$/m.exec(measured)?.[1]) !== crop.width || Number(/^\s*pixelHeight:\s*(\d+)\s*$/m.exec(measured)?.[1]) !== crop.height) throw Error('browser-viewport-invalid')
          content = page
        }
        return await encodePhoneCapture(sourceWidth, async width => {
          const resize = width < sourceWidth ? ['--resampleWidth', String(width)] : []
          await run('/usr/bin/sips', [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', content, '--out', shot], { timeout: 5000, maxBuffer: 4096 })
          return readFile(shot)
        })
      } catch (error) {
        if (['capture-invalid', 'browser-viewport-invalid'].includes(error?.message)) throw error
        throw Error('capture-unavailable')
      }
      finally { await Promise.all([rm(raw, { force: true }), rm(page, { force: true }), rm(padded, { force: true }), rm(shot, { force: true })]) }
    }
    async function send(bytes) {
      if (stop) throw Error('feed-stopped')
      let response
      try {
        response = await fetch(config.site + '/api/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'screen', jpeg: bytes.toString('base64') }), redirect: 'error', signal: AbortSignal.timeout(10_000) })
      } catch { throw Error('ingest-unavailable') }
      if ([401, 403].includes(response.status)) throw Error('credential-rejected')
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw Error('request-rejected')
      if (!response.ok) throw Error('ingest-unavailable')
      await response.body?.cancel()
    }
    await status('starting')
    while (!stop) {
      const started = Date.now()
      try {
        // The separate issuer replaces this limited capability atomically. Never
        // read the full ingest credential, and never retain an expired token.
        token = (await privateFile(config.tokenFile)).trim()
        expiresAt = capabilityExpiry(token)
        await captureAndSend(config, { token, now: Date.now, inspect, capture, send })
        lastSentAt = new Date().toISOString(); failures = 0; lastFailureReason = null
        await status(args.includes('--once') ? 'sent-once' : 'sending')
        if (args.includes('--once')) break
        await sleep(Math.max(0, config.everyMs - (Date.now() - started)))
      } catch (error) {
        const code = safeFailure(error), retry = captureFailureState(failures, code)
        failures = retry.failures
        await status(retry.state, { reason: code, nextRetryAt: retry.stop ? null : new Date(Date.now() + retry.delayMs).toISOString() })
        if (code !== lastFailureReason) console.error(code)
        lastFailureReason = code
        if (retry.stop || args.includes('--once')) { process.exitCode = 1; break }
        await sleep(retry.delayMs)
      }
    }
    if (stop) await status('stopped')
  } finally {
    if (parentWatch) clearInterval(parentWatch)
    if (temp) await rm(temp, { recursive: true, force: true })
    await rm(lock, { force: true })
  }
}
main().catch(() => { console.error('Phone feed could not start. Check private configuration, window identity, Screen Recording permission, token expiry, and whether another feed owns the lock. No credential was printed.'); process.exitCode = 1 })
