// Finishes a sent launch: reads the coin back off chain and, only when the 80/20 split is
// locked to the right wallets, puts the bot on the grid for Grok Bot to run. Called by the
// launching tab, and by /api/launch/status for launches whose tab was closed early.
import type { AgentRecord } from './agents.js'
import { parse, redis } from './_lib.js'
import { LOOKS, agentId, keepWallet, keys, type Draft } from './_launch.js'
import { launchProgress, verifyLaunch } from './_pump.js'

type Pending = { draft: Draft; launcher: string; bot: string; burn: string; signature: string | null; raw?: string; lastValidBlockHeight?: number }
type Result = { status: number; body: Record<string, unknown> }

export const OPEN = 'gg:launch:open'

export async function finishLaunch(mint: string): Promise<Result> {
  const [done, raw] = await redis(['GET', `gg:mint:${mint}`], ['GET', keys.pending(mint)])
  if (typeof done === 'string') return out({ id: done })
  const p = parse<Pending>(raw)
  if (!p) {
    await redis(['SREM', OPEN, mint])
    return out({ error: 'No launch in progress for that coin.' }, 404)
  }

  const check = await verifyLaunch(mint, p.bot, p.burn)
  if (!check.ok && check.reason === 'not on chain yet') {
    if (p.signature && p.raw && p.lastValidBlockHeight) {
      const state = await launchProgress(p.raw, p.signature, p.lastValidBlockHeight)
      if (state === 'failed' || state === 'expired') await redis(['SREM', OPEN, mint], ['DEL', keys.lease(p.bot)])
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
  await keepWallet(p.bot)
  await redis(
    ['HSETNX', 'gg:agents', id, JSON.stringify(rec)],
    ['SET', `gg:mint:${mint}`, id],
    // the picture and metadata now belong to a live coin, so they stay for good
    ['PERSIST', keys.image(mint)],
    ['PERSIST', keys.meta(mint)],
    ['LPUSH', 'gg:launches', JSON.stringify({ id, mint, wallet: p.bot, ts: Date.now() })],
    ['LTRIM', 'gg:launches', 0, 199],
  )
  await redis(['SREM', OPEN, mint])
  return out({ id }, 200)
}

const out = (body: Record<string, unknown>, status = 200): Result => ({ status, body })
