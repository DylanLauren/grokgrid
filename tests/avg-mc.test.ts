import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avgMcs, avgRows } from '../src/lib/avgMc'

const t = (side: 'buy' | 'sell', tradeMc: number | undefined, sizeTokens: number, extra: Record<string, unknown> = {}) =>
  ({ ts: 0, side, mint: 'M', symbol: 'X', name: '', spentSol: 0.01, sizeTokens, tradeMc, pnlUsd: null, ...extra })

test('averages entry and exit market caps weighted by tokens', () => {
  const a = avgMcs([t('buy', 10_000, 1), t('buy', 40_000, 3), t('sell', 60_000, 4)]).get('M')!
  assert.equal(a.entry, 32_500)
  assert.equal(a.exit, 60_000)
  assert.equal(a.approx, false)
})

test('marks estimates and leaves a side empty when nothing traded there', () => {
  const a = avgMcs([t('buy', 20_000, 5, { tradeMcApprox: true }), t('buy', undefined, 5)]).get('M')!
  assert.equal(a.entry, 20_000)
  assert.equal(a.exit, undefined)
  assert.deepEqual(avgRows(a).map(([k, v]) => [k, v.startsWith('≈') || v === '–']), [['avg entry mc', true], ['avg exit mc', true]])
})
