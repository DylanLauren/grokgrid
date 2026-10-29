#!/usr/bin/env node
// Restarts only the pinned publisher. Reads config/status, never capability contents.
import { open, lstat, rename, unlink, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { validateConfig } from './phone-feed-core.mjs'
import { decidePhoneRestart, planPhoneLockRecovery } from './phone-supervisor-core.mjs'
const uid = () => process.getuid?.() ?? -1
const metadata = s => ({ isFile: s.isFile(), isSymbolicLink: s.isSymbolicLink(), uid: s.uid, mode: s.mode, nlink: s.nlink, dev: s.dev, ino: s.ino })
export async function readPrivatePhoneFile(path, limit = 32_768) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = await handle.stat()
    if (!s.isFile() || s.uid !== uid() || (s.mode & 0o077) || s.nlink !== 1 || s.size > limit) throw Error('private-input-required')
    return { contents: await handle.readFile('utf8'), metadata: metadata(s) }
  } finally { await handle.close() }
}
export function phoneProcessState(pid) {
  try { process.kill(pid, 0); return 'alive' } catch (e) { return e?.code === 'ESRCH' ? 'dead' : 'unknown' }
}
export async function recoverPhoneLock(path, processState = phoneProcessState) {
  try { await lstat(path) } catch (e) { if (e?.code === 'ENOENT') return 'absent'; throw Error('lock-unverifiable') }
  // Serialize recovery itself: two supervisors must not both inspect a dead
  // lock, then let the slower one unlink the faster one's newly acquired lock.
  // A crashed recovery guard is deliberately manual-review only.
  const guardPath = path + '.recovery'
  let guard
  try { guard = await open(guardPath, 'wx', 0o600) } catch { throw Error('lock-recovery-busy') }
  const guardIdentity = await guard.stat()
  try {
    await guard.writeFile(String(process.pid)); await guard.sync()
    let old
    try { old = await readPrivatePhoneFile(path, 32) } catch (e) { if (e?.code === 'ENOENT') return 'absent'; throw Error('lock-unverifiable') }
    const pid = /^[1-9]\d{0,9}\n?$/.test(old.contents) ? Number(old.contents.trim()) : -1
    const plan = planPhoneLockRecovery({ ...old, expectedUid: uid(), processState: pid > 0 ? processState(pid) : 'unknown' })
    if (plan.action !== 'remove-lock') throw Error(plan.reason)
    const current = await readPrivatePhoneFile(path, 32)
    if (current.metadata.dev !== plan.expected.dev || current.metadata.ino !== plan.expected.ino || current.contents !== plan.expected.contents || processState(pid) !== 'dead') throw Error('lock-changed')
    const final = await lstat(path)
    if (!final.isFile() || final.isSymbolicLink() || final.dev !== plan.expected.dev || final.ino !== plan.expected.ino) throw Error('lock-changed')
    await unlink(path)
    return 'recovered'
  } finally {
    await guard.close()
    try { const current = await lstat(guardPath); if (current.dev === guardIdentity.dev && current.ino === guardIdentity.ino) await unlink(guardPath) } catch {}
  }
}

async function privateRoot(root) {
  const s = await lstat(root)
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== uid() || (s.mode & 0o077) || await realpath(root) !== root) throw Error('private-directory-required')
}
async function writeStatus(path, value) {
  try { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.uid !== uid() || (s.mode & 0o077) || s.nlink !== 1) throw Error('private-output-required') } catch (e) { if (e?.code !== 'ENOENT') throw e }
  const tmp = join(dirname(path), `.phone-supervisor-${randomUUID()}.tmp`)
  const handle = await open(tmp, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync() } finally { await handle.close() }
  try { await rename(tmp, path) } finally { await unlink(tmp).catch(() => {}) }
}
async function capabilityIdentity(path) {
  // Metadata only: the full secret is never used and even screen token contents
  // remain confined to the publisher/renewal process.
  const s = await lstat(path)
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== uid() || (s.mode & 0o077) || s.nlink !== 1) throw Error('private-capability-required')
  return `${s.dev}:${s.ino}:${s.mtimeMs}:${s.size}`
}
export async function runPhoneSupervisor(configPath, dependencies = {}) {
  // The native app already launches this CLI without optional arguments. Pin
  // the current parent by default so that installation needs no TCC re-sign.
  const parentPid = dependencies.parentPid ?? (process.ppid > 1 ? process.ppid : undefined)
  if (parentPid !== undefined && (!Number.isSafeInteger(parentPid) || parentPid < 1 || parentPid > 2_147_483_647)) throw Error('invalid-parent-pid')
  const getParentPid = dependencies.getParentPid ?? (() => process.ppid)
  const root = dirname(resolve(configPath)); await privateRoot(root)
  const { contents } = await readPrivatePhoneFile(resolve(configPath))
  const config = validateConfig(JSON.parse(contents))
  const videoPath = config.videoConfigFile
  if (videoPath !== undefined) {
    if (typeof videoPath !== 'string' || resolve(videoPath) !== videoPath || dirname(videoPath) !== root) throw Error('private-video-config-required')
    await readPrivatePhoneFile(videoPath)
  }
  await privateRoot(dirname(resolve(config.statusFile))); await privateRoot(dirname(resolve(config.tokenFile)))
  const supervisorStatus = join(root, 'local-phone-supervisor-status.json'), lockPath = supervisorStatus + '.lock'
  const protectedPaths = [resolve(config.statusFile), resolve(config.tokenFile), resolve(configPath), supervisorStatus, lockPath, resolve(config.statusFile) + '.lock', ...(videoPath ? [videoPath] : [])]
  if (new Set(protectedPaths).size !== protectedPaths.length) throw Error('configuration-path-collision')
  await recoverPhoneLock(lockPath)
  const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.sync(); const own = await lock.stat(); await lock.close()
  let stop = false, child = null, video = null, videoDone = Promise.resolve(), videoKillTimer, restarts = 0, stopReason = 'operator-stop'
  const abort = new AbortController()
  const stopVideo = () => {
    if (!video) return videoDone
    const current = video
    current.kill('SIGTERM')
    if (!videoKillTimer) videoKillTimer = setTimeout(() => current.kill('SIGKILL'), 12_000)
    return videoDone
  }
  const requestStop = reason => {
    if (!stop) stopReason = reason === 'parent-exited' ? 'parent-exited' : 'operator-stop'
    stop = true; abort.abort(); child?.kill('SIGTERM'); stopVideo()
  }
  // Compare our actual parent relationship; never signal a caller-supplied PID.
  const checkParent = () => {
    if (parentPid === undefined || stop) return
    try { if (getParentPid() !== parentPid) requestStop('parent-exited') } catch { requestStop('parent-exited') }
  }
  const parentWatcher = parentPid === undefined ? null : setInterval(checkParent, 1000)
  parentWatcher?.unref?.()
  process.on('SIGINT', requestStop); process.on('SIGTERM', requestStop)
  const wait = async ms => { try { await delay(ms, undefined, { signal: abort.signal }) } catch {} }
  // Preserve call order even if a child exits before its initial status fsync.
  let statusWrites = Promise.resolve()
  const status = (state, extra = {}) => {
    const value = { version: 1, state, observedAt: new Date().toISOString(), childPid: child?.pid ?? null, videoPid: video?.pid ?? null, restartCount: restarts, ...extra }
    const write = statusWrites.then(() => writeStatus(supervisorStatus, value))
    statusWrites = write.catch(() => {})
    return write
  }
  const launch = dependencies.spawnPublisher ?? (() => spawn(process.execPath, [fileURLToPath(new URL('./phone-feed.mjs', import.meta.url)), '--config', resolve(configPath)], { stdio: 'ignore' }))
  const launchVideo = dependencies.spawnVideo ?? (() => spawn(process.execPath, [fileURLToPath(new URL('./phone-video-controller.mjs', import.meta.url)), '--config', videoPath, '--run'], { stdio: 'ignore' }))
  try {
    checkParent()
    while (!stop) {
      // A surviving publisher is not adopted or killed; operator review is safer
      // than duplicate publishers after a supervisor-only crash.
      await recoverPhoneLock(config.statusFile + '.lock')
      const tokenBefore = await capabilityIdentity(config.tokenFile), started = Date.now()
      checkParent()
      if (stop) break
      if (videoPath) {
        video = launchVideo()
        const currentVideo = video
        videoDone = new Promise(resolveVideo => {
          let settled = false
          const ended = () => { if (settled) return; settled = true; if (videoKillTimer) clearTimeout(videoKillTimer); videoKillTimer = undefined; if (video === currentVideo) video = null; resolveVideo() }
          video.once('error', ended); video.once('exit', ended)
        })
      }
      child = launch()
      let killTimer
      const result = await new Promise(resolveExit => {
        let settled = false
        const done = result => { if (!settled) { settled = true; if (killTimer) clearTimeout(killTimer); resolveExit(result) } }
        child.once('error', () => done({ exitCode: 1, signal: null }))
        child.once('exit', (exitCode, signal) => done({ exitCode, signal }))
        const onAbort = () => { child?.kill('SIGTERM'); killTimer = setTimeout(() => child?.kill('SIGKILL'), 20_000); killTimer.unref?.() }
        abort.signal.addEventListener('abort', onAbort, { once: true })
        child.once('exit', () => abort.signal.removeEventListener('abort', onAbort))
        if (stop) onAbort()
        status('publishing-process-running').catch(requestStop)
      })
      child = null
      // Pause, source failure, credential holds and app restarts terminate both
      // publishers. Only a new supervised cycle may start a new video controller.
      await stopVideo()
      if (stop) break
      let last = null
      try { last = JSON.parse((await readPrivatePhoneFile(config.statusFile)).contents); if (Date.parse(last.observedAt) < started || Date.parse(last.observedAt) > Date.now() + 1000 || !Number.isFinite(Date.parse(last.observedAt))) last = null } catch {}
      const decision = decidePhoneRestart({ ...result, status: last, restarts })
      if (decision.action === 'stop') { await status('stopped-needs-operator', { reason: decision.reason }); return }
      if (decision.action === 'wait-renewal') {
        await status('waiting-for-capability-renewal', { reason: decision.reason })
        while (!stop) { if (await capabilityIdentity(config.tokenFile) !== tokenBefore) break; await wait(30_000) }
        if (stop) break
      } else {
        await status('waiting-to-restart', { reason: decision.reason, nextRetryAt: new Date(Date.now() + decision.delayMs).toISOString() })
        await wait(decision.delayMs)
      }
      restarts++
    }
    await status('stopped', { reason: stopReason })
  } catch {
    await status('stopped-needs-operator', { reason: 'supervisor-unavailable' }).catch(() => {})
    throw Error('supervisor-unavailable')
  } finally {
    if (parentWatcher) clearInterval(parentWatcher)
    process.off('SIGINT', requestStop); process.off('SIGTERM', requestStop)
    if (child) child.kill('SIGTERM')
    await stopVideo()
    try { const current = await lstat(lockPath); if (current.dev === own.dev && current.ino === own.ino) await unlink(lockPath) } catch {}
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  const parentPid = args.length === 4 && args[2] === '--parent-pid' && /^[1-9]\d{0,9}$/.test(args[3]) ? Number(args[3]) : undefined
  if (![2, 4].includes(args.length) || args[0] !== '--config' || !args[1]?.startsWith('/') || (args.length === 4 && (!Number.isSafeInteger(parentPid) || parentPid > 2_147_483_647))) { console.error('Usage: phone-supervisor.mjs --config /absolute/private/publisher-config.json [--parent-pid PID]'); process.exitCode = 1 }
  else runPhoneSupervisor(args[1], { parentPid }).catch(() => { console.error('Phone supervisor stopped. Inspect private status, permissions, source identity and locks; no credential was printed.'); process.exitCode = 1 })
}
