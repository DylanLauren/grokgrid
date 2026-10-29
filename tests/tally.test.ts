import test from 'node:test'
import assert from 'node:assert/strict'
import { tally } from '../api/_tally'

const t = (side: 'buy' | 'sell', mint: string, spentSol: number, sizeTokens: number, ts: number) => ({ side, mint, spentSol, sizeTokens, ts })

test('realised p&l and win rate come from verified buys and sells, newest-first input', () => {
  const a1 = t('buy', 'A', 0.002, 100, 1), a2 = t('sell', 'A', 0.003, 100, 2)
  const b1 = t('buy', 'B', 0.001, 50, 3), b2 = t('sell', 'B', 0.0004, 50, 4)
  const r = tally([b2, b1, a2, a1])
  assert.equal(r.closed, 2)
  assert.ok(Math.abs(r.pnl.get(a2)! - 0.001) < 1e-12)
  assert.ok(Math.abs(r.pnl.get(b2)! + 0.0006) < 1e-12)
  assert.ok(Math.abs(r.pnlSol! - 0.0004) < 1e-12)
  assert.equal(r.winRate, 50)
})

test('partial sells realise against average cost; open positions and orphan sells do not count', () => {
  const buy = t('buy', 'A', 0.004, 100, 1), half = t('sell', 'A', 0.003, 50, 2)
  const r = tally([half, buy, t('sell', 'Z', 1, 10, 3), t('buy', 'C', 0.5, 10, 4)])
  assert.equal(r.closed, 1)
  assert.ok(Math.abs(r.pnl.get(half)! - 0.001) < 1e-12)
  assert.equal(tally([buy]).pnlSol, null)
  assert.equal(tally([]).winRate, null)
})
