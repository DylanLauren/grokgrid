// Local issuer only. Never import this module from the screen publisher.
import { constants } from 'node:fs'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { dirname, basename, isAbsolute, parse, resolve, join } from 'node:path'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const CAPABILITY_LIFETIME_MS = 24 * 60 * 60 * 1000
export const CAPABILITY_RENEW_BEFORE_MS = 6 * 60 * 60 * 1000
const MAX_FILE_BYTES = 16_384
const uid = () => process.getuid?.()
function fail() { throw Error('phone-renewal-unavailable') }
function absolutePath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) fail()
  return path
}
function ownerMode(s, directory = false) {
  if ((directory ? !s.isDirectory() : !s.isFile()) || s.uid !== uid() || (s.mode & 0o077) !== 0 || (!directory && s.nlink !== 1)) fail()
}
// Reject symbolic links in every component, including ancestors; do not silently
// resolve a credential path through a symlink into another directory.
async function noSymlinks(path, missingLeaf = false) {
  absolutePath(path)
  let current = parse(path).root
  const pieces = path.slice(current.length).split('/').filter(Boolean)
  for (let i = 0; i < pieces.length; i++) {
    current = join(current, pieces[i])
    let s
    try { s = await lstat(current) } catch (error) {
      if (error?.code === 'ENOENT' && missingLeaf && i === pieces.length - 1) return
      fail()
    }
    if (s.isSymbolicLink() || (i < pieces.length - 1 && !s.isDirectory())) fail()
  }
}
async function privateDirectory(path) {
  await noSymlinks(path)
  ownerMode(await lstat(path), true)
}
async function readPrivate(path) {
  await noSymlinks(path)
  await privateDirectory(dirname(path))
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    ownerMode(info)
    if (info.size > MAX_FILE_BYTES) fail()
    const contents = await handle.readFile('utf8')
    if (Buffer.byteLength(contents) > MAX_FILE_BYTES) fail()
    return { contents, info }
  } finally { await handle.close() }
}
async function destinationInfo(path) {
  await noSymlinks(path, true)
  try { return await readPrivate(path) } catch (error) {
    // Only an absent leaf is eligible for creation. Never hide permission or
    // malformed-path errors as "missing" and overwrite a protected resource.
    try { await lstat(path) } catch (statError) { if (statError?.code === 'ENOENT') return null }
    throw error
  }
}
function verifiedExpiry(token, secret, now) {
  const match = /^screen-v1\.(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token)
  if (!match) fail()
  const expiresAt = Number(match[1]) * 1000
  if (!Number.isSafeInteger(expiresAt) || expiresAt > now + 7 * 86_400_000) fail()
  const payload = `screen-v1.${match[1]}.${match[2]}`
  const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'))
  if (!timingSafeEqual(expected, Buffer.from(match[3]))) fail()
  return expiresAt
}
function result(state, expiresAt) {
  return { state, expiresAt: new Date(expiresAt).toISOString(), renewAfter: new Date(expiresAt - CAPABILITY_RENEW_BEFORE_MS).toISOString() }
}
async function removeOwned(path, identity) {
  if (!identity) return
  try {
    const s = await lstat(path)
    if (s.isFile() && !s.isSymbolicLink() && s.dev === identity.dev && s.ino === identity.ino && s.uid === uid()) await unlink(path)
  } catch (error) { if (error?.code !== 'ENOENT') throw error }
}

async function createLock(path) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  const identity = await handle.stat()
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), runId: randomBytes(16).toString('hex') }))
    await handle.sync()
    return { handle, identity }
  } catch (error) {
    await handle.close()
    await removeOwned(path, identity)
    throw error
  }
}
function lockPid(contents) {
  if (Buffer.byteLength(contents) > 2048) fail()
  let metadata
  try { metadata = JSON.parse(contents) } catch { fail() }
  if (!metadata || !Number.isSafeInteger(metadata.pid) || metadata.pid <= 1 || metadata.pid > 2_147_483_647 || !/^[a-f0-9]{32}$/.test(metadata.runId) || typeof metadata.createdAt !== 'string' || !Number.isFinite(Date.parse(metadata.createdAt))) fail()
  return metadata.pid
}
async function definitelyDead(pid, probeProcess) {
  try { await probeProcess(pid); return false } catch (error) { return error?.code === 'ESRCH' }
}
// Exported for isolated lock tests. Production uses process.kill(pid, 0), never
// an inferred process age or a weak PID-reuse heuristic.
export async function acquireIssuerLock(path, { probeProcess = pid => process.kill(pid, 0) } = {}) {
  absolutePath(path)
  await privateDirectory(dirname(path))
  await noSymlinks(path, true)
  try { return await createLock(path) } catch (error) { if (error?.code !== 'EEXIST') throw error }
  // Serialize recovery itself. Without this guard, two recoverers could inspect
  // the same old inode and one could unlink the other's newly acquired lock.
  // A crashed recovery guard is held for operator review, never recursively swept.
  const guardPath = path + '.recover.lock'
  const guard = await createLock(guardPath)
  try {
    const original = await readPrivate(path)
    const pid = lockPid(original.contents)
    if (!await definitelyDead(pid, probeProcess)) fail()
    // Re-probe before the final inode/content check: alive, EPERM, and PID reuse
    // all hold the lock. Only two explicit ESRCH results permit recovery.
    if (!await definitelyDead(pid, probeProcess)) fail()
    const latest = await readPrivate(path)
    if (original.info.dev !== latest.info.dev || original.info.ino !== latest.info.ino || original.contents !== latest.contents) fail()
    const finalPath = await lstat(path)
    ownerMode(finalPath)
    if (finalPath.isSymbolicLink() || finalPath.dev !== original.info.dev || finalPath.ino !== original.info.ino) fail()
    await unlink(path)
    // A regular new issuer may win this exclusive create. In that case we fail
    // without deleting its lock, and the scheduler can try again later.
    return await createLock(path)
  } finally {
    await guard.handle.close()
    await removeOwned(guardPath, guard.identity)
  }
}

// configPath, sourceTokenFile and destinationTokenFile must be absolute private
// files with private parent directories. No secret or token is returned.
export async function renewFromConfig(configPath, { now = Date.now } = {}) {
  if (typeof uid() !== 'number' || !constants.O_NOFOLLOW) fail()
  const configRead = await readPrivate(absolutePath(configPath))
  let config
  try { config = JSON.parse(configRead.contents) } catch { fail() }
  if (!config || Array.isArray(config) || Object.keys(config).sort().join(',') !== 'destinationTokenFile,sourceTokenFile') fail()
  const source = absolutePath(config.sourceTokenFile)
  const destination = absolutePath(config.destinationTokenFile)
  if (new Set([configPath, source, destination]).size !== 3) fail()
  await privateDirectory(dirname(destination))
  await noSymlinks(destination, true)
  const lockPath = destination + '.renew.lock'
  const { handle: lock, identity: lockIdentity } = await acquireIssuerLock(lockPath)
  let tempPath, tempIdentity
  try {
    const sourceRead = await readPrivate(source)
    const secret = sourceRead.contents.trim()
    if (!secret || secret.startsWith('screen-v1.')) fail()
    const old = await destinationInfo(destination)
    if (old && sourceRead.info.dev === old.info.dev && sourceRead.info.ino === old.info.ino) fail()
    const currentTime = now()
    if (!Number.isSafeInteger(currentTime) || currentTime <= 0) fail()
    const oldExpiry = old ? verifiedExpiry(old.contents.trim(), secret, currentTime) : null
    if (oldExpiry !== null && oldExpiry - currentTime > CAPABILITY_RENEW_BEFORE_MS) return result('current', oldExpiry)
    const expiresAt = Math.floor((currentTime + CAPABILITY_LIFETIME_MS) / 1000) * 1000
    const payload = `screen-v1.${expiresAt / 1000}.${randomBytes(16).toString('hex')}`
    const capability = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
    tempPath = join(dirname(destination), `.${basename(destination)}.${randomBytes(16).toString('hex')}.tmp`)
    const temp = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      tempIdentity = await temp.stat()
      await temp.writeFile(capability + '\n')
      await temp.sync()
    } finally { await temp.close() }
    // Revalidate destination identity before replacing it. Unexpected changes
    // require operator review rather than overwriting a newer credential.
    const latest = await destinationInfo(destination)
    if (!!old !== !!latest || (old && (old.info.dev !== latest.info.dev || old.info.ino !== latest.info.ino || old.contents !== latest.contents))) fail()
    await rename(tempPath, destination)
    tempIdentity = undefined
    const directory = await open(dirname(destination), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
    return result(old ? 'renewed' : 'created', expiresAt)
  } finally {
    await lock.close()
    try { if (tempPath) await removeOwned(tempPath, tempIdentity) }
    finally { await removeOwned(lockPath, lockIdentity) }
  }
}
