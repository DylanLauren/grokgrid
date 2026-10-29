import { test } from 'node:test'
import assert from 'node:assert/strict'
import { curveFrom } from '../api/_tally.ts'

test('wallet curve walks back from the balance now through each trade', () => {
  const calls = [
    { side: 'sell' as const, mint: 'a', spentSol: 0.0012, ts: 3000 },
    { side: 'buy' as const, mint: 'a', spentSol: 0.001, ts: 2000 },
  ]
  const c = curveFrom(calls, 0.1002, 5000)
  assert.deepEqual(c.map((p) => p.ts), [1999, 2000, 3000, 5000])
  const sol = c.map((p) => Number(p.sol.toFixed(6)))
  assert.deepEqual(sol, [0.1, 0.099, 0.1002, 0.1002])
})

test('no trades gives just the balance now', () => {
  assert.deepEqual(curveFrom([], 0.5, 10), [{ ts: 10, sol: 0.5 }])
})
