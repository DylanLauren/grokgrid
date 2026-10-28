// Finishes a sent launch: reads the coin back off chain and, only when the 80/20 split is
// locked to the right wallets, puts the bot on the grid for Grok Bot to run. Called by the
// launching tab, and by /api/launch/status for launches whose tab was closed early.
import type { AgentRecord } from './agents.js'
import { parse, redis } from './_lib.js'
import { LOOKS, agentId, releaseWallet, keys, type Draft } from './_launch.js'
import { launchProgress, verifyLaunch } from './_pump.js'

type Pending = { draft: Draft; launcher: string; bot: string; burn: string; signature: string | null; raw?: string; lastValidBlockHeight?: number }
type Result = { status: number; body: Record<string, unknown> }

export const OPEN = 'gg:launch:open'

export async function finishLaunch(mint: string): Promise<Result> {
  const [done, raw] = await redis(['GET', `gg:mint:${mint}`], ['GET', keys.pending(mint)])
  if (typeof done === 'string') return out({ id: done })
  const p = parse<Pending>(raw)
  if (!p || !p.bot || !p.draft) {
    await redis(['SREM', OPEN, mint])
    return out({ error: 'No launch in progress for that coin.' }, 404)
  }

  if (!p.signature) return out({ retry: true }, 202)
  const check = await verifyLaunch(mint, p.bot, p.burn)
  if (!check.ok && check.reason === 'not on chain yet') {
    if (p.signature && p.raw && p.lastValidBlockHeight) {
      const state = await launchProgress(p.raw, p.signature, p.lastValidBlockHeight)
      if (state === 'failed' || state === 'expired') {
        await releaseWallet(p.bot, mint)
        await redis(['SREM', OPEN, mint])
      }
      if (state === 'failed') return out({ error: 'Solana rejected the launch, so no coin was made. Only the network fee was spent. Try again.' }, 400)
      if (state === 'expired') return out({ error: "The launch didn't land on Solana in time, so no coin was made and nothing was spent. Try again." }, 410)
    }
    return out({ retry: true }, 202)
  }
  if (!check.ok) return out({ error: check.reason }, 400)

  const d = p.draft
  const [color, shape] = LOOKS[d.look] ?? LOOKS[0]
  const id = agentId(d.ticker, mint)
  const rec: AgentRecord = {
    id,
    name: d.name,
    color,
    shape,
    strategy: d.strategy,
    launchedAt: Date.now(),
    wallet: p.bot,
    owner: p.launcher,
    rules: { maxSol: d.maxSol, takeProfit: d.takeProfit, stopLoss: d.stopLoss },
    coin: { mint, symbol: d.ticker, name: d.name, image: `/i/${mint}`, hue: color },
  }
  // All state changes, including the queue entry, happen once in one Redis call.
  const [saved] = await redis(['EVAL', `
    local done = redis.call('GET', KEYS[1])
    if done then return done end
    if redis.call('GET', KEYS[2]) ~= ARGV[1] then return false end
    redis.call('SREM', KEYS[3], ARGV[2])
    redis.call('SADD', KEYS[4], ARGV[2])
    redis.call('DEL', KEYS[2])
    redis.call('HSET', KEYS[5], ARGV[3], ARGV[4])
    redis.call('SET', KEYS[1], ARGV[3])
    redis.call('PERSIST', KEYS[6])
    redis.call('PERSIST', KEYS[7])
    redis.call('LPUSH', KEYS[8], ARGV[5])
    redis.call('LTRIM', KEYS[8], 0, 199)
    redis.call('SREM', KEYS[9], ARGV[1])
    return ARGV[3]
  `, 9, `gg:mint:${mint}`, keys.lease(p.bot), keys.pool, keys.used, 'gg:agents',
  keys.image(mint), keys.meta(mint), 'gg:launches', OPEN,
  mint, p.bot, id, JSON.stringify(rec), JSON.stringify({ id, mint, wallet: p.bot, ts: Date.now() })])
  if (typeof saved !== 'string') return out({ error: 'The trading wallet reservation needs review.' }, 409)
  return out({ id }, 200)
}

const out = (body: Record<string, unknown>, status = 200): Result => ({ status, body })
