import { grid } from './agents.js'
import { hasStore, isAddress, json } from './_lib.js'

// One bot's profile: the bot, its own coin, its whole trade history with each traded
// coin's market stats, and its wallet curve. ?id= takes the bot id or its coin's mint,
// so a coin's pump.fun website link (grokgrid.fun/#matrix/<mint>) lands here.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!(/^[a-z0-9-]{2,32}$/.test(id) || isAddress(id))) return json({ error: 'id' }, 400)
  if (!hasStore()) return json({ mode: 'demo' })
  const g = await grid(id)
  const agent = g?.agents[0]
  if (!agent) return json({ error: 'not found' }, 404)
  return json({ mode: 'live', updatedAt: Date.now(), solUsd: g.solUsd, agent })
}
