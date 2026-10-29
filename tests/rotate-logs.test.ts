import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rotate } from '../scripts/rotate-logs.mjs'

test('logs over the limit are copied to .1, older copies shift, at most 3 are kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gg-logs-'))
  try {
    const log = join(dir, 'strategy.log')
    for (const gen of ['a', 'b', 'c', 'd']) {
      await writeFile(log, gen.repeat(20))
      assert.deepEqual(await rotate(dir, 10, 3), ['strategy.log'])
      assert.equal((await stat(log)).size, 0) // truncated in place, so launchd keeps writing to it
    }
    assert.equal(await readFile(`${log}.1`, 'utf8'), 'd'.repeat(20))
    assert.equal(await readFile(`${log}.3`, 'utf8'), 'b'.repeat(20))
    await assert.rejects(stat(`${log}.4`))
    await writeFile(log, 'small')
    assert.deepEqual(await rotate(dir, 10, 3), [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
