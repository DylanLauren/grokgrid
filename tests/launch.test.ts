import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentId, cleanDraft, metadataJson } from '../api/_launch'
import { firstBuyLamports } from '../api/_pump'

const good = { look: 3, name: 'Night Shift', ticker: '$night', description: 'trades while you sleep', x: 'https://x.com/nightbot', telegram: '', strategy: 'buys dips under 30k', maxSol: '0.25', takeProfit: 100, stopLoss: 30, firstBuy: '' }

test('a launch draft is cleaned and checked before anything is built', () => {
  const d = cleanDraft(good)
  assert.equal(d.ticker, 'NIGHT')
  assert.equal(d.maxSol, 0.25)
  assert.throws(() => cleanDraft({ ...good, ticker: 'x' }), /Ticker/)
  assert.throws(() => cleanDraft({ ...good, strategy: '' }), /Strategy/)
  assert.throws(() => cleanDraft({ ...good, x: 'https://evil.com/a' }), /x\.com/)
  assert.throws(() => cleanDraft({ ...good, telegram: 'javascript:alert(1)' }), /https/)
  assert.equal('website' in cleanDraft({ ...good, website: 'https://evil.example' }), false) // launchers can't set a website
  assert.throws(() => cleanDraft({ ...good, stopLoss: 99 }), /Stop loss/)
  assert.equal(cleanDraft({ ...good, look: 99 }).look, 0)
})

test('a bot can have its own name, and shares the coin name when left blank', () => {
  assert.equal(cleanDraft(good).botName, 'Night Shift')
  assert.equal(cleanDraft({ ...good, botName: '  Night Owl ' }).botName, 'Night Owl')
  assert.equal(metadataJson(cleanDraft({ ...good, botName: 'Night Owl' }), 'M').name, 'Night Shift') // the coin keeps its own name
  assert.throws(() => cleanDraft({ ...good, botName: 'x'.repeat(33) }), /Bot name/)
})

test('metadata points pump.fun at our picture and the bot\'s own GrokGrid profile', () => {
  const m = metadataJson(cleanDraft(good), 'So11111111111111111111111111111111111111112')
  assert.match(m.image, /\/i\/So111/)
  assert.match(m.website, /^https:\/\/.+\/#matrix\/So11111111111111111111111111111111111111112$/)
  assert.equal(m.twitter, 'https://x.com/nightbot')
})

test('first buy amounts are exact and capped', () => {
  assert.equal(firstBuyLamports(''), 0n)
  assert.equal(firstBuyLamports('0.5'), 500_000_000n)
  assert.throws(() => firstBuyLamports('11'))
  assert.throws(() => firstBuyLamports('0.0001'))
  assert.throws(() => firstBuyLamports('1e3'))
})

test('agent ids fit the registry format', () => {
  assert.match(agentId('NIGHT', '8TD5SUxyz'), /^[a-z0-9-]{2,32}$/)
})

test('launches close once the grid is full, and when the count is unknown', async () => {
  const { agentCap, isFull } = await import('../api/_launch.ts')
  assert.equal(agentCap(undefined), 100)
  assert.equal(agentCap('50'), 50)
  assert.equal(agentCap('0'), 100)
  assert.equal(agentCap('9000'), 100)
  assert.equal(isFull(100, 99), false)
  assert.equal(isFull(100, 100), true)
  assert.equal(isFull(100, null), true)
})
