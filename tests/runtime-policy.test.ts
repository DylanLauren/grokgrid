import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Node script shared with the observer
import { fundState, validateRuntime } from '../scripts/runtime-policy.mjs'
import { GET } from '../api/runtime.js'
import { GET as buyback } from '../api/buyback.js'
import { createHmac } from 'node:crypto'
const house = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const burn = 'E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq'
const base = { balanceLamports: '1000000000', previousLamports: '100000000', reserveLamports: '10000000', thresholdLamports: '50000000', mint: house, mintVerified: true }
test('mint is required, and funding never enables execution', () => {
  assert.equal(fundState({ ...base, mint: '' }).state, 'awaiting-official-mint')
  assert.equal(fundState({ ...base, mintVerified: false }).state, 'mint-unverified')
  const s = fundState(base)
  assert.equal(s.state, 'funds-detected-execution-disabled')
  assert.equal(s.availableLamports, '990000000')
  assert.equal(s.balanceChangeLamports, '900000000')
  assert.equal(s.executionEnabled, false)
  assert.equal(s.revenueVerified, false)
})
test('reserve, low balance, invalid amount and initial observation', () => {
  assert.equal(fundState({ ...base, balanceLamports: '1' }).availableLamports, '0')
  assert.equal(fundState({ ...base, balanceLamports: '1' }).state, 'below-threshold')
  assert.equal(fundState({ ...base, previousLamports: undefined }).balanceChangeLamports, null)
  assert.throws(() => fundState({ ...base, balanceLamports: '-1' }))
  assert.throws(() => fundState({ ...base, thresholdLamports: '0' }))
})
test('remote config cannot silently change wallet or enable orders', () => {
  const c = { version: 1, mode: 'observe-only', signingEnabled: false, buybackExecutionEnabled: false, houseWallet: house, burnWallet: burn, officialMint: '' }
  assert.equal(validateRuntime(c, house, burn), c)
  assert.throws(() => validateRuntime({ ...c, houseWallet: burn }, house, burn))
  assert.throws(() => validateRuntime({ ...c, signingEnabled: true }, house, burn))
})
test('runtime configuration requires full ingest authentication', async () => {
  assert.equal((await GET(new Request('https://example.test/api/runtime'))).status, 401)
  assert.equal((await buyback(new Request('https://example.test/api/buyback'))).status, 401)
  const before = process.env.INGEST_TOKEN
  process.env.INGEST_TOKEN = 'test-runtime-secret'
  try {
    const payload = `screen-v1.${Math.floor(Date.now() / 1000) + 60}.${'b'.repeat(32)}`
    const token = `${payload}.${createHmac('sha256', process.env.INGEST_TOKEN).update(payload).digest('hex')}`
    const screen = new Request('https://example.test/api/runtime', { headers: { authorization: `Bearer ${token}` } })
    assert.equal((await GET(screen)).status, 401)
    assert.equal((await buyback(screen)).status, 401)
    const response = await GET(new Request('https://example.test/api/runtime', { headers: { authorization: 'Bearer test-runtime-secret' } }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).signingEnabled, false)
  } finally {
    if (before === undefined) delete process.env.INGEST_TOKEN
    else process.env.INGEST_TOKEN = before
  }
})
