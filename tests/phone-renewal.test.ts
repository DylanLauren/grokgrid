import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, writeFile, readFile, stat, lstat, rm, chmod, symlink, link, open, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
// @ts-expect-error Node module is intentionally independent of application TS.
import { renewFromConfig, acquireIssuerLock, CAPABILITY_LIFETIME_MS, CAPABILITY_RENEW_BEFORE_MS } from '../scripts/phone-renew-core.mjs'
const now = 1_800_000_000_000
const secret = 'fixture-only-never-a-real-credential'
async function fixture() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'grokgrid-renew-test-'))
  await chmod(directory, 0o700)
  const source = join(directory, 'source'), destination = join(directory, 'screen'), config = join(directory, 'config.json')
  await writeFile(source, secret, { mode: 0o600 })
  await writeFile(config, JSON.stringify({ sourceTokenFile: source, destinationTokenFile: destination }), { mode: 0o600 })
  return { directory, source, destination, config, cleanup: () => rm(directory, { recursive: true, force: true }) }
}
function capability(expires: number) {
  const payload = `screen-v1.${Math.floor(expires / 1000)}.${'c'.repeat(32)}`
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
}

test('creates only scoped capability privately, with24h expiry and unchanged source', async () => {
  const f = await fixture()
  try {
    const result = await renewFromConfig(f.config, { now: () => now })
    const token = (await readFile(f.destination, 'utf8')).trim()
    assert.equal(token.startsWith('screen-v1.'), true)
    const parts = token.split('.')
    assert.equal(parts.length, 4)
    assert.equal(parts[3], createHmac('sha256', secret).update(parts.slice(0, 3).join('.')).digest('hex'))
    assert.equal(Number(parts[1]) * 1000, now + CAPABILITY_LIFETIME_MS)
    assert.equal(result.state, 'created')
    assert.equal((await stat(f.destination)).mode & 0o777, 0o600)
    assert.equal(await readFile(f.source, 'utf8'), secret)
    assert.equal(JSON.stringify(result).includes(token), false)
    assert.equal(JSON.stringify(result).includes(secret), false)
    await assert.rejects(lstat(f.destination + '.renew.lock'), { code: 'ENOENT' })
  } finally { await f.cleanup() }
})
test('valid token outside renewal window remains byte-for-byte and inode unchanged', async () => {
  const f = await fixture()
  try {
    const token = capability(now + CAPABILITY_RENEW_BEFORE_MS + 1000)
    await writeFile(f.destination, token, { mode: 0o600 })
    const before = await stat(f.destination)
    assert.equal((await renewFromConfig(f.config, { now: () => now })).state, 'current')
    assert.equal(await readFile(f.destination, 'utf8'), token)
    assert.equal((await stat(f.destination)).ino, before.ino)
  } finally { await f.cleanup() }
})
test('near-expiry and expired tokens rotate atomically; existing reader keeps complete old bytes', async () => {
  for (const expiry of [now + CAPABILITY_RENEW_BEFORE_MS, now - 1000]) {
    const f = await fixture()
    try {
      const token = capability(expiry)
      await writeFile(f.destination, token, { mode: 0o600 })
      const oldHandle = await open(f.destination, 'r')
      try {
        const oldInode = (await oldHandle.stat()).ino
        assert.equal((await renewFromConfig(f.config, { now: () => now })).state, 'renewed')
        assert.equal(await oldHandle.readFile('utf8'), token)
        assert.notEqual((await stat(f.destination)).ino, oldInode)
        assert.notEqual((await readFile(f.destination, 'utf8')).trim(), token)
      } finally { await oldHandle.close() }
    } finally { await f.cleanup() }
  }
})
test('malformed, wrong-signature or full-scope destination never gets overwritten', async () => {
  for (const value of ['invalid', secret, capability(now + 1000).slice(0, -1) + 'x']) {
    const f = await fixture()
    try {
      await writeFile(f.destination, value, { mode: 0o600 })
      await assert.rejects(renewFromConfig(f.config, { now: () => now }))
      assert.equal(await readFile(f.destination, 'utf8'), value)
    } finally { await f.cleanup() }
  }
})
test('unsafe source/config/destination permissions and nonprivate directory reject renewal', async () => {
  for (const target of ['source', 'config', 'destination', 'directory'] as const) {
    const f = await fixture()
    try {
      await writeFile(f.destination, capability(now + 1000), { mode: 0o600 })
      await chmod(f[target], target === 'directory' ? 0o755 : 0o644)
      await assert.rejects(renewFromConfig(f.config, { now: () => now }))
    } finally { await f.cleanup() }
  }
})
test('symlink and hardlink source/destination aliases are rejected', async () => {
  for (const target of ['source', 'destination'] as const) for (const kind of ['symlink', 'hardlink']) {
    const f = await fixture()
    try {
      const backing = join(f.directory, 'backing')
      await writeFile(backing, target === 'source' ? secret : capability(now + 1000), { mode: 0o600 })
      await rm(f[target], { force: true })
      if (kind === 'symlink') await symlink(backing, f[target]); else await link(backing, f[target])
      await assert.rejects(renewFromConfig(f.config, { now: () => now }))
      assert.equal(await readFile(backing, 'utf8'), target === 'source' ? secret : capability(now + 1000))
    } finally { await f.cleanup() }
  }
})
test('malformed issuer lock is never reclaimed automatically', async () => {
  const f = await fixture()
  try {
    const lock = f.destination + '.renew.lock'
    await writeFile(lock, 'another-run', { mode: 0o600 })
    await assert.rejects(renewFromConfig(f.config, { now: () => now }))
    assert.equal(await readFile(lock, 'utf8'), 'another-run')
    await assert.rejects(stat(f.destination), { code: 'ENOENT' })
  } finally { await f.cleanup() }
})
test('config cannot alias source or destination and rejects unexpected secret fields', async () => {
  const f = await fixture()
  try {
    for (const c of [{ sourceTokenFile: f.source, destinationTokenFile: f.source }, { sourceTokenFile: f.source, destinationTokenFile: f.destination, token: secret }]) {
      await writeFile(f.config, JSON.stringify(c))
      await assert.rejects(renewFromConfig(f.config, { now: () => now }))
      assert.equal(await readFile(f.source, 'utf8'), secret)
    }
  } finally { await f.cleanup() }
})

test('symlinked ancestor directory and symlinked config are rejected', async () => {
  const f = await fixture()
  const alias = f.directory + '-alias'
  try {
    await symlink(f.directory, alias)
    await assert.rejects(renewFromConfig(join(alias, 'config.json'), { now: () => now }))
    const linkedConfig = join(f.directory, 'config-link.json')
    await symlink(f.config, linkedConfig)
    await assert.rejects(renewFromConfig(linkedConfig, { now: () => now }))
    await assert.rejects(stat(f.destination), { code: 'ENOENT' })
  } finally { await rm(alias, { force: true }); await f.cleanup() }
})

function staleLock(pid = 42) { return JSON.stringify({ pid, createdAt: '2026-10-28T00:00:00.000Z', runId: 'd'.repeat(32) }) }
const noSuchProcess = () => { throw Object.assign(Error('process absent'), { code: 'ESRCH' }) }
test('dead issuer lock is recovered only after repeated ESRCH probes', async () => {
  const f = await fixture()
  const path = f.destination + '.renew.lock'
  try {
    await writeFile(path, staleLock(), { mode: 0o600 })
    const old = await stat(path)
    let probes = 0
    const held = await acquireIssuerLock(path, { probeProcess: () => { probes++; noSuchProcess() } })
    try {
      assert.equal(probes, 2)
      const metadata = JSON.parse(await readFile(path, 'utf8'))
      assert.equal(metadata.pid, process.pid)
      assert.notEqual(metadata.runId, 'd'.repeat(32))
      assert.equal(held.identity.ino, (await stat(path)).ino)
      assert.equal(old.uid, held.identity.uid)
      await assert.rejects(stat(path + '.recover.lock'), { code: 'ENOENT' })
    } finally { await held.handle.close() }
  } finally { await f.cleanup() }
})
test('live issuer, EPERM, and PID reuse all hold the original lock', async () => {
  const f = await fixture()
  const path = f.destination + '.renew.lock'
  try {
    const original = staleLock(process.pid)
    await writeFile(path, original, { mode: 0o600 })
    await assert.rejects(acquireIssuerLock(path))
    assert.equal(await readFile(path, 'utf8'), original)
    await assert.rejects(acquireIssuerLock(path, { probeProcess: () => { throw Object.assign(Error('permission'), { code: 'EPERM' }) } }))
    let probes = 0
    await assert.rejects(acquireIssuerLock(path, { probeProcess: () => { if (++probes === 1) noSuchProcess(); return true } }))
    assert.equal(probes, 2)
    assert.equal(await readFile(path, 'utf8'), original)
  } finally { await f.cleanup() }
})
test('replacement lock detected during dead-process probing is not unlinked', async () => {
  const f = await fixture()
  const path = f.destination + '.renew.lock'
  try {
    await writeFile(path, staleLock(), { mode: 0o600 })
    const replacement = staleLock(process.pid)
    let probes = 0
    await assert.rejects(acquireIssuerLock(path, { probeProcess: async () => {
      if (++probes === 2) {
        await rename(path, path + '.old')
        await writeFile(path, replacement, { mode: 0o600 })
      }
      noSuchProcess()
    } }))
    assert.equal(await readFile(path, 'utf8'), replacement)
  } finally { await f.cleanup() }
})
test('concurrent or uncertain recovery guard prevents reclamation', async () => {
  const f = await fixture()
  const path = f.destination + '.renew.lock'
  try {
    const original = staleLock()
    await writeFile(path, original, { mode: 0o600 })
    await writeFile(path + '.recover.lock', staleLock(process.pid), { mode: 0o600 })
    await assert.rejects(acquireIssuerLock(path, { probeProcess: noSuchProcess }))
    assert.equal(await readFile(path, 'utf8'), original)
    assert.equal(await readFile(path + '.recover.lock', 'utf8'), staleLock(process.pid))
  } finally { await f.cleanup() }
})
