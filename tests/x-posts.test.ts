import assert from 'node:assert/strict'
import { test } from 'node:test'
import { oauthHeader, pendingPosts, postGate, postText, sendPost, validCreds, DEFAULT_X } from '../scripts/x-posts.mjs'

const trade = (sig: string, side = 'buy', state = 'reconciled-confirmed') => ({ state, side, signature: sig, mint: 'So11111111111111111111111111111111111111112', receipt: { spentLamports: '50000000', receivedLamports: '61000000' } })
const creds = { apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw', accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' }

test('only real reconciled trades post, once each', () => {
  const state = { intents: [trade('a'), trade('b', 'sell'), trade('c', 'buy', 'submitted'), { ...trade('d'), receipt: undefined }] }
  assert.deepEqual(pendingPosts(state, { posted: {} }).map(i => i.signature), ['a', 'b'])
  assert.deepEqual(pendingPosts(state, { posted: { a: { at: 1, outcome: 'posted' } } }).map(i => i.signature), ['b'])
  assert.deepEqual(pendingPosts(undefined, { posted: {} }), [])
})

test('post text names the coin, SOL, links and fits a tweet', () => {
  const t = postText(trade('sig1'), 'GRID<script>')
  assert.match(t, /^bought \$GRIDscript for 0\.050 SOL\n/)
  assert.match(t, /solscan\.io\/tx\/sig1/)
  assert.match(postText(trade('s', 'sell'), undefined), /^sold a coin for 0\.061 SOL/)
  assert.ok(t.length <= 280)
})

test('posting is off by default and capped per day', () => {
  assert.equal(postGate({ posted: {} }, DEFAULT_X, 0), 'disabled')
  const on = { ...DEFAULT_X, xPostsEnabled: true, maxPerDay: 2 }
  const now = 100_000_000
  assert.equal(postGate({ posted: { a: { at: now - 1000, outcome: 'posted' } } }, on, now), 'ok')
  assert.equal(postGate({ posted: { a: { at: now - 1000, outcome: 'posted' }, b: { at: now - 2000, outcome: 'posted' } } }, on, now), 'daily-cap')
  assert.equal(postGate({ posted: { a: { at: now - 90_000_000, outcome: 'posted' }, b: { at: now - 2000, outcome: 'rejected-403' } } }, on, now), 'ok')
})

test('OAuth 1.0a signature matches the published X example', () => {
  // Keys and nonce from X's signature docs; the expected signature was cross-checked with oauthlib.
  const h = oauthHeader('POST', 'https://api.x.com/2/tweets', creds, 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', 1318622958)
  assert.match(h, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1318622958", oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", oauth_version="1.0", oauth_signature="lr%2BtV%2FDKclEvXKVjG6tgaSSLV0k%3D"$/)
  assert.equal(h, oauthHeader('POST', 'https://api.x.com/2/tweets', creds, 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', 1318622958))
  assert.ok(validCreds(creds))
  assert.equal(validCreds({ ...creds, apiSecret: '' }), false)
})

test('sendPost posts JSON with an OAuth header and returns the tweet id', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fake = async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ data: { id: '42' } }), { status: 201 }) }
  const r = await sendPost('hi', creds, fake as typeof fetch)
  assert.deepEqual(r, { status: 201, id: '42' })
  assert.equal(seen!.url, 'https://api.x.com/2/tweets')
  assert.equal(JSON.parse(String(seen!.init.body)).text, 'hi')
  assert.match(String((seen!.init.headers as Record<string, string>).authorization), /^OAuth /)
})
