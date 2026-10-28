// Sends the signed launch, but only if it is still exactly the one we built.
import { hasStore, isAddress, parse, redis } from '../_lib.js'
import { friendly, pinWallet, keys, limited, noStore, readJson } from '../_launch.js'
import { authorizedLaunch } from '../_verify.js'
import { OPEN } from '../_finish.js'
import { validationTables, broadcastLaunch, broadcastSetup, saveTable, tableReady } from '../_pump.js'

type Pending = { bot: string; message: string; setup: { table: string; expected: string[]; messages: string[] } | null; signature: string | null } & Record<string, unknown>

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'send', 20)
  if (slow) return slow
  const b = await readJson<{ mint?: unknown; tx?: unknown; setup?: unknown }>(req, 20_000)
  if (!b || !isAddress(b.mint) || typeof b.tx !== 'string') return noStore({ error: 'bad request' }, 400)
  const [raw] = await redis(['GET', keys.pending(b.mint)])
  const pending = parse<Pending>(raw)
  if (!pending || !isAddress(pending.bot) || typeof pending.message !== 'string') return noStore({ error: 'This launch expired. Try again.' }, 410)
  if (pending.signature) return noStore({ signature: pending.signature })
  if (pending.sending) return noStore({ error: 'This launch is already being submitted. Check its status before retrying.' }, 409)
  let signature: string
  try {
    signature = authorizedLaunch(b.tx, pending.message, await validationTables(pending.message, pending.setup))
    const recovery = JSON.stringify({ ...pending, signature: null, sending: true })
    if (!(await pinWallet(pending.bot, b.mint, raw as string, recovery))) return noStore({ error: 'This launch expired. Try again.' }, 410)
    // The coin may land at any moment now, so its picture and metadata must not expire.
    await redis(['PERSIST', keys.image(b.mint)], ['PERSIST', keys.meta(b.mint)])
    // The site's first launch also opens its lookup table, in the same approval.
    if (pending.setup && !(await tableReady(pending.setup.table, pending.setup.expected))) {
      if (!Array.isArray(b.setup) || !b.setup.every((s) => typeof s === 'string')) return noStore({ error: 'This launch expired. Try again.' }, 410)
      await broadcastSetup(b.setup as string[], pending.setup.messages)
      let ready = false
      for (let i = 0; i < 20 && !ready; i++) {
        ready = await tableReady(pending.setup.table, pending.setup.expected)
        if (!ready) await new Promise((r) => setTimeout(r, 1000))
      }
      if (!ready) throw Error('Solana is slow right now. Try the launch again.')
    }
    if (pending.setup) await saveTable(pending.setup.table)
    // Persist the authorized signed bytes before sending, so a lost RPC response
    // can be reconciled without recycling the trading wallet.
    await redis(['SET', keys.pending(b.mint), JSON.stringify({ ...pending, signature, raw: b.tx })])
    signature = await broadcastLaunch(b.tx, pending.message)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    console.error('launch send', msg)
    if (/blockhash|expired/i.test(msg)) return noStore({ error: 'The launch took too long to sign. Try again.' }, 400)
    if (/insufficient|0x1\b/i.test(msg)) return noStore({ error: 'Not enough SOL in this wallet for the launch and first buy.' }, 400)
    return noStore({ error: friendly(e) ?? 'The network rejected the launch. Check your wallet activity before retrying.' }, 400)
  }
  // The signed bytes are kept so the confirm step can re-send them until they land.
  await redis(['SET', keys.pending(b.mint), JSON.stringify({ ...pending, signature, raw: b.tx })], ['SADD', OPEN, b.mint])
  return noStore({ signature })
}
