import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fresh, readBeat, runnerReady, STALE_MS } from '../api/_heartbeat'

const now = 1_800_000_000_000
const beat = (o: Record<string, unknown>) => readBeat({ worker: 'agent-runner', mode: 'execute', healthy: true, ...o }, now)

test('a beat needs a known worker, a known mode and a health flag', () => {
  assert.ok(beat({}))
  assert.equal(beat({ worker: 'miner' }), null)
  assert.equal(beat({ mode: 'yolo' }), null)
  assert.equal(beat({ healthy: 'yes' }), null)
  assert.equal(beat({ agents: -1 })?.agents, null)
  assert.equal(beat({ note: 'x\u0000'.repeat(100) })?.note.length, 80)
})

test('launches open only for a fresh, healthy runner in execute mode with the operator switch on', () => {
  const b = beat({})!
  assert.equal(runnerReady({ 'agent-runner': b }, '1', now), true)
  assert.equal(runnerReady({ 'agent-runner': b }, undefined, now), false)
  assert.equal(runnerReady({ 'agent-runner': b }, '1', now + STALE_MS + 1), false)
  assert.equal(runnerReady({ 'agent-runner': beat({ mode: 'paper' })! }, '1', now), false)
  assert.equal(runnerReady({ 'agent-runner': beat({ healthy: false })! }, '1', now), false)
  assert.equal(runnerReady({ trading: b }, '1', now), false)
})

test('a beat from the future is not fresh', () => {
  assert.equal(fresh({ ...beat({})!, ts: now + 60_000 }, now), false)
})
