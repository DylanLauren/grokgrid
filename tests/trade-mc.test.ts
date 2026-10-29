import test from 'node:test'
import assert from 'node:assert/strict'
import { fillMcUsd, fillFromLogs, PUMP_SUPPLY_TOKENS } from '../scripts/trade-mc-core.mjs'
import { postTradeMc } from '../scripts/runtime-ingest.mjs'

test('market cap from a fill: SOL per whole token x 1B supply x SOL/USD', () => {
  // 0.002635741 SOL for 288.331497 tokens at $100/SOL
  const mc = fillMcUsd({ lamports: '2635741', units: '288331497' }, 6, 100)!
  assert.ok(Math.abs(mc - (0.002635741 / 288.331497) * PUMP_SUPPLY_TOKENS * 100) < 1e-6)
  assert.equal(fillMcUsd({ lamports: '0', units: '1' }, 6, 100), null)
  assert.equal(fillMcUsd({ lamports: '1', units: '1' }, 6, 0), null)
})

test('only matching pump.fun events count; anything else is no fill', () => {
  const intent = { side: 'sell', mint: 'M', receipt: { soldTokenUnits: '5' } }
  assert.equal(fillFromLogs(intent, 'W', ['Program log: hi', 'Program data: ' + Buffer.alloc(16).toString('base64')]), null)
  assert.equal(fillFromLogs(intent, 'W', undefined as unknown as string[]), null)
})

test('the backfill posts nothing for a missing market cap', async () => {
  assert.equal(await postTradeMc('/nowhere', { agent: 'house', sig: 's', mint: 'm', mcUsd: NaN }), 0)
})
