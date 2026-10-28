import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usd, signedUsd, mc, pct } from '../src/lib/format'
import { stats } from '../src/data/useFeed'
import type { Feed } from '../src/data/types'

test('unknown financial values are not formatted as zero or positive returns', () => {
 for (const f of [usd, signedUsd, mc, pct]) {
  assert.equal(f(null), '–')
  assert.equal(f(NaN), '–')
 }
 assert.equal(usd(0), '$0.00')
})
test('a sell with unknown cost basis does not become a loss or a zero-percent win rate', () => {
 const feed = { mode: 'live', wallet: null, solUsd: 100, calls: [{side:'sell',pnlUsd:null}], curve: [], feesSol:0,burnedMain:0 } as Feed
 const s=stats(feed)
 assert.equal(s.winRate,null)
 assert.equal(s.best,undefined)
 assert.equal(s.worst,undefined)
})
