import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

export async function readPrivateVideoFile(path) {
  if (!isAbsolute(path) || resolve(path) !== path) throw Error('private-path-required')
  let dir = dirname(path)
  while (true) {
    const s = await lstat(dir)
    if (!s.isDirectory() || s.isSymbolicLink()) throw Error('private-path-required')
    if (dir === dirname(path) && (s.uid !== process.getuid() || (s.mode & 0o077))) throw Error('private-directory-required')
    const parent = dirname(dir); if (parent === dir) break; dir = parent
  }
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = await f.stat()
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 65536) throw Error('private-file-required')
    return await f.readFile('utf8')
  } finally { await f.close() }
}
export function validateVideoConfig(c) {
  if (!c || c.roomName !== 'grokgrid-house' || c.publisherIdentity !== 'house-publisher') throw Error('video-room-invalid')
  const url = new URL(c.serverUrl)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.livekit.cloud') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('video-server-invalid')
  for (const k of ['sourceConfigFile','apiKeyFile','apiSecretFile','whipUrlFile','captureBinaryPath','ffmpegPath','statusFile']) if (typeof c[k] !== 'string' || !isAbsolute(c[k])) throw Error('video-path-invalid')
  if (new Set(['sourceConfigFile','apiKeyFile','apiSecretFile','whipUrlFile','statusFile'].map(k => c[k])).size !== 5) throw Error('video-path-collision')
  if (!Number.isSafeInteger(c.chromeWindowId) || c.chromeWindowId < 1) throw Error('video-window-invalid')
  if (c.expectedWindowSize !== undefined) {
    const {width,height}=c.expectedWindowSize||{}
    if (![width,height].every(Number.isSafeInteger) || width<250 || width>1000 || height<400 || height>1800 || width/height<0.35 || width/height>0.85) throw Error('video-window-size-invalid')
  }
  return { ...c, width: 780, fps: 15, pollMs: 3000, idleGraceMs: 5000 }
}
export async function preparePhoneVideoSource(config, {checkOnly,prepare,inspect}) {
  // The native prepare operation itself rechecks the exact binding immediately
  // before resizing. It is never called by read-only --check or without opt-in.
  if (!checkOnly && config.expectedWindowSize) await prepare()
  return await inspect()
}
export function countPhoneViewers(participants) {
  if (!Array.isArray(participants)) throw Error('viewer-query-invalid')
  return participants.filter(p => /^viewer-[0-9a-f-]{36}$/i.test(p.identity || '') && p.kind === 0 && p.permission?.canSubscribe === true && p.permission?.canPublish === false && p.permission?.canPublishData === false).length
}
export function videoDemand({ viewers, running, lastViewerAt, now, queryOk = true }) {
  if (!queryOk) return 'stop-unverified'
  if (viewers > 0) return running ? 'keep' : 'start'
  return running && now - lastViewerAt < 5000 ? 'keep' : running ? 'stop-idle' : 'idle'
}
export function videoRestartDecision({ captureCode, captureSignal, encoderCode, encoderSignal, attempts }) {
  // A guard failure never keeps publishing. Restart is possible only after the
  // controller's full exact-pin inspection passes again; no pin is changed.
  if (captureCode === 3) return attempts < 3 ? { restart:true,delayMs:5000*2**attempts,revalidateSource:true } : { restart:false,reason:'source-review-required' }
  if (captureCode != null && ![4,5].includes(captureCode)) return { restart: false, reason: 'publisher-review-required' }
  const transport = captureCode === 4 || captureCode === 5 || Number.isInteger(encoderCode) || typeof encoderSignal === 'string'
  if (!transport || attempts >= 3) return { restart: false, reason: 'publisher-review-required' }
  return { restart: true, delayMs: 5000 * 2 ** attempts }
}
export function videoStartupFailure({ elapsedMs, frameBytes, signaling }) {
  if (elapsedMs < 20000) return null
  if (frameBytes === 0) return 'capture-startup-timeout'
  if (!signaling.some(e => e.event === 'upstream-response' && e.method === 'POST' && e.status >= 200 && e.status < 300)) return 'signaling-startup-timeout'
  return null
}
export function validateWhipUrl(value) {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.livekit.cloud') || url.username || url.password || url.hash) throw Error('whip-url-invalid')
  return url.href
}
export function ffmpegPhoneArgs({ width, height, fps }, localUrl) {
  const u = new URL(localUrl)
  if (u.hostname !== '127.0.0.1' || u.protocol !== 'http:' || ![width,height,fps].every(Number.isSafeInteger) || width < 2 || height < 2 || width % 2 || height % 2 || fps < 1 || fps > 30) throw Error('video-encoder-invalid')
  return ['-hide_banner','-loglevel','error','-nostdin','-f','rawvideo','-pixel_format','bgra','-video_size',`${width}x${height}`,'-framerate',String(fps),'-use_wallclock_as_timestamps','1','-i','pipe:0','-an','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-profile:v','baseline','-pix_fmt','yuv420p','-bf','0','-g',String(fps * 2),'-b:v','1800k','-maxrate','2200k','-bufsize','1800k','-f','whip',localUrl]
}
