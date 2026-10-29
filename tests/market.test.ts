import test from 'node:test'
import assert from 'node:assert/strict'
import { rows } from '../scripts/market-recorder.mjs'
import { series, simulate, passes, evaluate } from '../scripts/market-analyze.mjs'

const MINT = 'So11111111111111111111111111111111111111pump'
const row = (t: number, price: number, extra: Record<string, unknown> = {}) => ({ t, mint: MINT, price, ageMin: 30, liq: 20000, mc: 50000, v5m: 6000, b5m: 60, s5m: 30, c5m: 10, c1h: 40, ...extra })

test('recorder keeps the deepest pump.fun/PumpSwap SOL pair per mint and ignores others', () => {
  const pair = (dexId: string, liq: number, quote = 'SOL') => ({ dexId, baseToken: { address: MINT, symbol: 'X' }, quoteToken: { symbol: quote }, liquidity: { usd: liq }, priceNative: '0.000001', pairCreatedAt: 1 })
  const out = rows([pair('pumpfun', 100), pair('pumpswap', 500), pair('raydium', 9000), pair('pumpswap', 9000, 'USDC')], 60000)
  assert.equal(out.length, 1); assert.equal(out[0].liq, 500); assert.equal(out[0].ageMin, 1)
})

test('simulate exits on take-profit, on stop-loss at the gapped price, or at max hold, net of fees and slippage', () => {
  const x = { tp: 0.5, sl: 0.25, holdMin: 60 }
  const up = series([row(0, 1), row(60000, 1.2), row(120000, 1.7)]).get(MINT)!
  const tp = simulate(up, 0, x)!; assert.equal(tp.reason, 'tp'); assert.ok(tp.ret > 0.5 && tp.ret < 0.6)
  const down = series([row(0, 1), row(60000, 0.5)]).get(MINT)!
  const sl = simulate(down, 0, x)!; assert.equal(sl.reason, 'sl'); assert.ok(sl.ret < -0.5) // gapped well past -25%
  const flat = series([row(0, 1), row(30 * 60000, 1.01), row(61 * 60000, 1.02)]).get(MINT)!
  assert.equal(simulate(flat, 0, x)!.reason, 'time')
  assert.equal(simulate(series([row(0, 1)]).get(MINT)!, 0, x), null)
})

test('one entry per coin per rule; filters fail closed on missing data', () => {
  const by = series([row(0, 1), row(60000, 1.6), row(120000, 1), row(180000, 1.6)])
  const f = { age: [0, 100], liq: 0, mc: [0, 1e9], v5m: 0, ratio: 1, c5m: [-100, 100], c1h: [-100, 100] }
  assert.equal(evaluate(by, f, { tp: 0.5, sl: 0.25, holdMin: 60 }, 0, 1e12).n, 1)
  assert.equal(passes(row(0, 1, { c5m: null }), f), false)
  assert.equal(passes(row(0, 1, { b5m: 10, s5m: 30 }), f), false)
})
