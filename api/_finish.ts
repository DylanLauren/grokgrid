// Finishes a sent launch: reads the coin back off chain and, only when the 80/20 split is
// locked to the right wallets, puts the bot on the grid for Grok Bot to run. Called by the
// launching tab, and by /api/launch/status for launches whose tab was closed early.
import type { AgentRecord } from './agents.js'
import { parse, redis } from './_lib.js'
import { LOOKS, agentId, keys, type Draft } from './_launch.js'
import { ownerKeys } from './_launch-owner.js'
import { FINALIZE_OWNER_LUA } from './_launch-finalize.js'
import { launchProgress, verifyLaunch } from './_pump.js'

type Pending = { routingVersion?: number; phase?: string; privyWalletId?: string; draft: Draft; launcher: string; bot: string; burn: string; signature: string | null; authorizedSignature?: string; raw?: string; lastValidBlockHeight?: number }
type Result = { status: number; body: Record<string, unknown> }

export const OPEN = 'gg:launch:open'

export async function finishLaunch(mint: string): Promise<Result> {
  const [done, raw] = await redis(['GET', `gg:mint:${mint}`], ['GET', keys.pending(mint)])
  if (typeof done === 'string') return out({ id: done })
  const p = parse<Pending>(raw)
  if (!p || !p.bot || !p.draft) {
    return out({ error: 'This launch record is unavailable or incomplete. Its reservation has not been released and needs review.' }, 409)
  }

  if(!routable(p))return out({error:'This older launch requires review. Its wallet reservation has been retained.'},409)
  if (p.phase === 'released') return out({ error: RELEASED, released: true }, 410)
  // A signed launch that can never land (its blockhash expired unsent, or it failed on chain,
  // which undoes the whole transaction) frees the wallet, so one dropped approval never
  // blocks the owner from launching again.
  const sig = p.signature ?? p.authorizedSignature
  if (sig && p.raw && (p.phase === 'setup-pending' || p.phase === 'launch-submitted')) {
    const state = await launchProgress(p.raw, sig, p.lastValidBlockHeight ?? 0)
    if ((state === 'failed' || state === 'expired') && !(await verifyLaunch(mint, p.bot, p.burn)).ok) {
      const [freed] = await redis(['EVAL', RELEASE_LUA, 3, keys.pending(mint), ownerKeys.hold(p.launcher), OPEN, raw as string, mint, JSON.stringify({ ...p, phase: 'released', releasedAt: Date.now() })])
      if (Number(freed) === 1) return out({ error: RELEASED, released: true }, 410)
    }
  }
  if (!p.signature) return out({ retry: true }, 202)
  if(p.phase!=='launch-submitted')return out({error:'This signed launch setup requires review before reconciliation.'},409)
  const check = await verifyLaunch(mint, p.bot, p.burn)
  if (!check.ok && check.reason === 'not on chain yet') return out({ retry: true }, 202)
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
    name: d.botName || d.name, // launches prepared before bot names had only the coin name
    color,
    shape,
    strategy: d.strategy,
    launchedAt: Date.now(),
    wallet: p.bot,
    owner: p.launcher,
    rules: { maxSol: d.maxSol, takeProfit: d.takeProfit, stopLoss: d.stopLoss, style: d.style ?? 'steady' },
    coin: { mint, symbol: d.ticker, name: d.name, image: `/i/${mint}`, hue: color },
    ...(p.privyWalletId ? { privyWalletId: p.privyWalletId } : {}),
  }
  // All state changes, including the queue entry, happen once in one Redis call.
  const [saved] = await redis(['EVAL', FINALIZE_OWNER_LUA, 12,
    `gg:mint:${mint}`, ownerKeys.hold(p.launcher), ownerKeys.agent(p.launcher), 'gg:agents', keys.pending(mint),
    keys.image(mint), keys.meta(mint), 'gg:launches', OPEN,
    'gg:launch:event-payloads', 'gg:launch:event-order', 'gg:launch:event-sequence',
    mint, p.launcher, id, JSON.stringify(rec), JSON.stringify({id,mint,wallet:p.bot,ts:Date.now(),...(p.privyWalletId?{privyWalletId:p.privyWalletId}:{})}), raw as string, p.bot])
  if (typeof saved !== 'string' || saved.startsWith('!')) return out({ error: 'The owner wallet reservation or launch record needs review.' }, 409)
  return out({ id }, 200)
}

// v2: the launching wallet is the bot's trading wallet. v3: the owner's own wallet launched and
// funded a separate bot wallet in the same approval.
export const routable = (p: { routingVersion?: number; bot?: string; launcher?: string }) =>
  (p.routingVersion === 2 && p.bot === p.launcher) || (p.routingVersion === 3 && typeof p.bot === 'string' && p.bot !== p.launcher)

const RELEASED = "That launch didn't go through, so nothing was created. You can launch again."
// Only the exact record we read is released, and only this mint's hold on the owner.
export const RELEASE_LUA = `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
if redis.call('GET',KEYS[2])==ARGV[2] then redis.call('DEL',KEYS[2]) end
redis.call('SREM',KEYS[3],ARGV[2])
redis.call('SET',KEYS[1],ARGV[3],'EX',86400)
return 1`

const out = (body: Record<string, unknown>, status = 200): Result => ({ status, body })
