import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoFeed } from '../src/data/demo'
import { demoAgents, driftAgents, withRealCoins } from '../src/data/demoAgents'
import snapshot from '../src/data/tokenSnapshot.json'
import { cachedCoins, realCoins } from '../src/data/realCoins'

test('every sample trade uses a real mint and picture from the verified snapshot', () => {
  const feed = demoFeed()
  assert.ok(feed.calls.length > 10)
  for (const call of feed.calls) {
    const token = snapshot.coins.find((c) => c.mint === call.mint)
    assert.ok(token)
    assert.equal(call.image, token.image)
    assert.equal(call.nowMc, token.mcUsd)
    assert.equal(call.sample, true)
    assert.equal(call.sig, undefined)
  }
})

test('market updates match by mint, preserve sample P&L and never randomly drift real market values', () => {
  const grid = demoAgents()
  const tokens = snapshot.coins.toReversed().map((c) => ({ ...c, mcUsd: c.mcUsd + 100 }))
  const updated = withRealCoins(grid, tokens)
  const drifted = driftAgents(updated)
  for (const [i, agent] of updated.agents.entries()) {
    assert.equal(agent.coin.mint, grid.agents[i].coin.mint)
    assert.equal(agent.pnlSol, grid.agents[i].pnlSol)
    assert.equal(agent.coin.mcUsd, grid.agents[i].coin.mcUsd + 100)
    assert.equal(drifted.agents[i].coin.mcUsd, agent.coin.mcUsd)
    assert.ok(agent.coin.image)
    assert.ok(agent.last?.image)
  }
  assert.equal(withRealCoins(grid, []), grid)
})

test('token client retains pictures on empty/error responses and deduplicates refreshes', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ coins: [] })
    assert.deepEqual(await realCoins(), snapshot.coins)
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.deepEqual(await realCoins(), snapshot.coins)
    let requests = 0
    const fresh = snapshot.coins.map((c) => ({ ...c, mcUsd: c.mcUsd + 123 }))
    globalThis.fetch = async () => { requests++; return Response.json({ coins: fresh, updatedAt: Date.now() }) }
    const [a, b] = await Promise.all([realCoins(), realCoins()])
    assert.equal(requests, 1)
    assert.deepEqual(a, fresh)
    assert.deepEqual(a, b)
    assert.deepEqual(cachedCoins(), fresh)
  } finally { globalThis.fetch = original }
})
