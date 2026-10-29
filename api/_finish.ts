// Finishes a sent launch: reads the coin back off chain and, only when the 80/20 split is
// locked to the right wallets, puts the bot on the grid for Grok Bot to run. Called by the
// launching tab, and by /api/launch/status for launches whose tab was closed early.
import type { AgentRecord } from './agents.js'
import { parse, redis } from './_lib.js'
import { LOOKS, agentId, keys, type Draft } from './_launch.js'
import { ownerKeys } from './_launch-owner.js'
import { FINALIZE_OWNER_LUA } from './_launch-finalize.js'
import { launchProgress, verifyLaunch } from './_pump.js'

type Pending = { routingVersion?: number; phase?: string; privyWalletId?: string; draft: Draft; launcher: string; bot: string; burn: string; signature: string | null; raw?: string; lastValidBlockHeight?: number }
type Result = { status: number; body: Record<string, unknown> }

export const OPEN = 'gg:launch:open'

export async function finishLaunch(mint: string): Promise<Result> {
  const [done, raw] = await redis(['GET', `gg:mint:${mint}`], ['GET', keys.pending(mint)])
  if (typeof done === 'string') return out({ id: done })
  const p = parse<Pending>(raw)
  if (!p || !p.bot || !p.draft) {
    return out({ error: 'This launch record is unavailable or incomplete. Its reservation has not been released and needs review.' }, 409)
  }

  if(p.routingVersion!==2||p.bot!==p.launcher)return out({error:'This older launch requires review. Its wallet reservation has been retained.'},409)
  if (!p.signature) return out({ retry: true }, 202)
  if(p.phase!=='launch-submitted')return out({error:'This signed launch setup requires review before reconciliation.'},409)
  const check = await verifyLaunch(mint, p.bot, p.burn)
  if (!check.ok && check.reason === 'not on chain yet') {
    if (p.signature && p.raw && p.lastValidBlockHeight) {
      const state = await launchProgress(p.raw, p.signature, p.lastValidBlockHeight)
      if (state === 'failed' || state === 'expired') return out({ error: 'This signed launch needs chain reconciliation before its wallet can be reused. The reservation remains held.' }, 409)
    }
    return out({ retry: true }, 202)
  }
  if (!check.ok) return out({ error: check.reason }, 400)
  // The coin being on chain isn't enough: it must have come from the transaction we prepared
  // and checked, or someone could create the same mint with their own name and link.
  if (!p.raw || !p.lastValidBlockHeight) return out({ error: 'This launch needs review before it can join the grid.' }, 409)
  const landed = await launchProgress(p.raw, p.signature, p.lastValidBlockHeight)
  if (landed === 'pending') return out({ retry: true }, 202)
  if (landed !== 'landed') return out({ error: "This coin wasn't created by the launch you signed, so it can't join the grid. The reservation needs review." }, 409)

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
    ...(p.privyWalletId ? { privyWalletId: p.privyWalletId } : {}),
  }
  // All state changes, including the queue entry, happen once in one Redis call.
  const [saved] = await redis(['EVAL', FINALIZE_OWNER_LUA, 12,
    `gg:mint:${mint}`, ownerKeys.hold(p.launcher), ownerKeys.agent(p.launcher), 'gg:agents', keys.pending(mint),
    keys.image(mint), keys.meta(mint), 'gg:launches', OPEN,
    'gg:launch:event-payloads', 'gg:launch:event-order', 'gg:launch:event-sequence',
    mint, p.launcher, id, JSON.stringify(rec), JSON.stringify({id,mint,wallet:p.bot,ts:Date.now(),...(p.privyWalletId?{privyWalletId:p.privyWalletId}:{})}), raw as string])
  if (typeof saved !== 'string' || saved.startsWith('!')) return out({ error: 'The owner wallet reservation or launch record needs review.' }, 409)
  return out({ id }, 200)
}

const out = (body: Record<string, unknown>, status = 200): Result => ({ status, body })
