import test from 'node:test'
import assert from 'node:assert/strict'
import { whyOf } from '../src/lib/why'
import { whyText, buyWhy, sellWhy } from '../scripts/trade-why.mjs'

test('the site reads the reason back out of the note the worker wrote', () => {
  const sell = `${whyText(sellWhy('take-profit', { entryPriceSol: 1, openedAt: 0 }, 1.62, 42 * 60000), '$GOOD')} 0.031 SOL.`
  assert.equal(whyOf(sell), 'took profit at +62% after 42m.')
  const buy = `${whyText(buyWhy({ buys5m: 84, sells5m: 40, liquidityUsd: 48000 }, 0), '$GOOD')} 0.020 SOL.`
  assert.equal(whyOf(buy), 'buyers outpacing sellers 2.1× (84 buys in 5m), $48k liquidity.')
  assert.equal(whyOf('bought $GOOD for 0.020 SOL · strategy unvalidated'), undefined)
  assert.equal(whyOf(undefined), undefined); assert.equal(whyOf(''), undefined)
})

test('trade amounts read as short SOL figures, never raw lamport-precision decimals', async () => {
  const { sol } = await import('../src/lib/format')
  assert.equal(sol(0.014706754), '0.015')
  assert.equal(sol(0.005171421), '0.0052')
  assert.equal(sol(1.0763), '1.08')
  assert.equal(sol(0), '0')
})
