#!/usr/bin/env node
// Starts screen/video work only while authorized viewers are in the fixed room.
import { spawn } from 'node:child_process'
import { open, rename, unlink, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { RoomServiceClient } from 'livekit-server-sdk'
import { readPrivateVideoFile, validateVideoConfig, preparePhoneVideoSource, countPhoneViewers, videoDemand, videoRestartDecision, videoStartupFailure, safeCaptureFailure, ffmpegPhoneArgs } from './phone-video-core.mjs'
import { createWhipProxy } from './phone-video-whip.mjs'
import { recoverPhoneLock } from './phone-supervisor.mjs'
import { FOLLOW_FILE } from './phone-follow-core.mjs'

async function writePrivate(path, body) {
  const temp = path + '.' + randomUUID()
  const f = await open(temp, 'wx', 0o600)
  try { await f.writeFile(body); await f.sync() } finally { await f.close() }
  await rename(temp, path)
}
async function status(path, state, viewers, extra={}) { await writePrivate(path,JSON.stringify({state,viewers,observedAt:new Date().toISOString(),...extra})) }
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), 2000)
  try { await done } finally { clearTimeout(force) }
}
async function inspectSource(c, pin, mode='--check') {
  return await new Promise((resolve, reject) => {
    const p = spawn(c.captureBinaryPath, [mode], { stdio: ['pipe','pipe','ignore'] })
    let text = '', settled = false
    const fail = () => { if (!settled) { settled = true; reject(Error('source-check-failed')) }; p.kill('SIGKILL') }
    const timer = setTimeout(fail, 12000)
    p.stdout.on('data', d => { text += d; if (text.length > 2048) fail() })
    p.on('error', fail)
    p.on('close', code => { clearTimeout(timer); if (settled) return; settled = true; try { if (code !== 0) throw Error(); resolve(JSON.parse(text)) } catch { reject(Error('source-check-failed')) } })
    p.stdin.on('error', fail); p.stdin.end(JSON.stringify(pin))
  })
}
export async function runPhoneVideo(configPath, checkOnly = true) {
  const c = validateVideoConfig(JSON.parse(await readPrivateVideoFile(configPath)))
  const source = JSON.parse(await readPrivateVideoFile(c.sourceConfigFile))
  if (source.bundleId !== 'com.google.Chrome') throw Error('source-check-failed')
  const pin = { windowId: source.windowId, ownerPid: source.ownerPid, chromeWindowId: c.chromeWindowId, title: source.title, browserUrl: source.browserUrl, width: c.width, fps: c.fps, expectedWindowWidth:c.expectedWindowSize?.width,expectedWindowHeight:c.expectedWindowSize?.height, followFile: join(dirname(c.statusFile), FOLLOW_FILE) }
  const prepareSource = readOnly => preparePhoneVideoSource(c,{checkOnly:readOnly,prepare:()=>inspectSource(c,pin,'--prepare'),inspect:()=>inspectSource(c,pin)})
  if (checkOnly) { const dimensions = await prepareSource(true); return { state: 'source-check-passed', publishing: false, ...dimensions } }
  const root = await lstat(dirname(c.statusFile))
  if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid() || (root.mode & 0o077) || dirname(c.statusFile) !== dirname(configPath)) throw Error('private-directory-required')
  const key = (await readPrivateVideoFile(c.apiKeyFile)).trim(), secret = (await readPrivateVideoFile(c.apiSecretFile)).trim()
  if (!key || !secret) throw Error('provider-credentials-required')
  const room = new RoomServiceClient(c.serverUrl, key, secret)
  const lockPath = c.statusFile + '.lock'
  await recoverPhoneLock(lockPath)
  const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); const own = await lock.stat(); await lock.close()
  let ending = false, capture = null, encoder = null, proxy = null, lastViewerAt = 0, running = false, failures = 0
  let attempts = 0, retryAt = 0, startedAt = 0
  let encoderError = '', captureError = '', frameBytes = 0, signaling = [], frameSize=0, ownerRecoveries=0, originRebindings=0, captureLine=''
  const parent = process.ppid
  const stop = async () => {
    running = false
    await stopChild(capture); await stopChild(encoder); capture = null; encoder = null
    if (proxy) await proxy.close(); proxy = null
  }
  const terminate = () => { ending = true; capture?.kill('SIGTERM'); encoder?.kill('SIGTERM') }
  process.on('SIGTERM', terminate); process.on('SIGINT', terminate)
  try {
    while (!ending && process.ppid === parent && parent > 1) {
      let viewers = 0, queryOk = true, timer
      try {
        const participants = await Promise.race([room.listParticipants(c.roomName), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('viewer-timeout')), 5000) })])
        viewers = countPhoneViewers(participants); failures = 0
      } catch (error) {
        if (error?.code !== 'not_found') { queryOk = false; failures++ }
      } finally { clearTimeout(timer) }
      if (ending || process.ppid !== parent) break
      if (viewers) lastViewerAt = Date.now()
      const startupFailure=running?videoStartupFailure({elapsedMs:Date.now()-startedAt,frameBytes,signaling}):null
      if (running && (startupFailure || capture.exitCode !== null || capture.signalCode !== null || encoder.exitCode !== null || encoder.signalCode !== null)) {
        const safeCapture=safeCaptureFailure(captureError)
        const category=/Invalid argument/i.test(encoderError)?'invalid-argument':/Connection refused/i.test(encoderError)?'connection-refused':/Server returned|HTTP error/i.test(encoderError)?'http-rejected':/timed out|timeout/i.test(encoderError)?'timeout':'unclassified'
        await writePrivate(c.statusFile+'.diagnostic.json',JSON.stringify({observedAt:new Date().toISOString(),captureCode:capture.exitCode,captureSignal:capture.signalCode,captureReason:safeCapture,encoderCode:encoder.exitCode,encoderSignal:encoder.signalCode,encoderCategory:category,frameBytes,ownerRecoveries,originRebindings,signaling,startupFailure}))
        await writePrivate(c.statusFile+'.encoder-stderr.log',encoderError)
        await writePrivate(c.statusFile+'.capture-stderr.log',captureError)
        const retry = startupFailure ? {restart:attempts<3,delayMs:5000*2**attempts,reason:'publisher-review-required'} : videoRestartDecision({captureCode:capture.exitCode,captureSignal:capture.signalCode,encoderCode:encoder.exitCode,encoderSignal:encoder.signalCode,attempts})
        await stop()
        if (!retry.restart) { await status(c.statusFile,retry.reason,viewers); return }
        attempts++; retryAt=Date.now()+retry.delayMs
      }
      if (running && Date.now()-startedAt > 30000) attempts=0
      const demand = videoDemand({ viewers, running, lastViewerAt, now: Date.now(), queryOk })
      if (demand === 'idle' || demand === 'stop-idle') { attempts=0; retryAt=0 }
      if (demand.startsWith('stop')) { await stop(); await status(c.statusFile, demand, viewers) }
      if (failures >= 3) return
      if (demand === 'start' && Date.now() >= retryAt) {
        let dimensions
        try { dimensions = await prepareSource(false) } catch { await status(c.statusFile,'source-review-required',viewers); return }
        encoderError='';captureError='';frameBytes=0;signaling=[];ownerRecoveries=0;originRebindings=0;captureLine=''
        frameSize=dimensions.width*dimensions.height*4
        proxy = await createWhipProxy(await readPrivateVideoFile(c.whipUrlFile),{onEvent:event=>{if(signaling.length<20)signaling.push(event)}})
        encoder = spawn(c.ffmpegPath, ffmpegPhoneArgs(dimensions, proxy.url), { stdio: ['pipe','ignore','pipe'] })
        capture = spawn(c.captureBinaryPath, [], { stdio: ['pipe','pipe','pipe'] })
        encoder.stderr.on('data',data=>{encoderError=(encoderError+data).slice(-64000)})
        capture.stderr.on('data',data=>{
          captureError=(captureError+data).slice(-2000)
          const lines=(captureLine+data).split('\n');captureLine=lines.pop().slice(-2000)
          ownerRecoveries+=lines.filter(line=>line==='source-owner-recovered').length
          originRebindings+=lines.filter(line=>line==='source-origin-rebound').length
        })
        capture.stdout.on('data',data=>{frameBytes+=data.length})
        encoder.on('error', terminate); capture.on('error', terminate)
        encoder.stdin.on('error', () => capture?.kill('SIGTERM'))
        capture.stdin.on('error', terminate)
        capture.stdout.pipe(encoder.stdin)
        capture.stdin.end(JSON.stringify({ ...pin, expectedWidth: dimensions.width, expectedHeight: dimensions.height }))
        running = true
        startedAt = Date.now()
      }
      await status(c.statusFile, running ? 'publisher-processes-running' : retryAt > Date.now() && viewers ? 'transport-retry-backoff' : queryOk ? 'waiting-for-viewers' : 'viewer-query-unavailable', viewers, running?{frameBytes,ownerRecoveries,originRebindings,completeFrames:Math.floor(frameBytes/frameSize),elapsedMs:Date.now()-startedAt,signaling:signaling.slice(-3)}:{})
      await delay(c.pollMs)
    }
  } finally {
    await stop()
    process.off('SIGTERM', terminate); process.off('SIGINT', terminate)
    try { const s = await lstat(lockPath); if (s.dev === own.dev && s.ino === own.ino) await unlink(lockPath) } catch {}
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), index = args.indexOf('--config')
  if (index < 0 || !args[index + 1]?.startsWith('/') || args.some((v, i) => !['--config','--run','--check'].includes(v) && i !== index + 1) || args.includes('--run') && args.includes('--check')) {
    console.error('video-configuration-required'); process.exitCode = 1
  } else runPhoneVideo(args[index + 1], !args.includes('--run')).then(result => { if (result) console.log(JSON.stringify(result)) }).catch(() => { console.error('video-controller-stopped'); process.exitCode = 1 })
}
