// Sends the signed launch, but only if it is still exactly the one we built.
import { hasStore, isAddress, parse, redis } from '../_lib.js'
import { friendly, keys, limited, noStore, readJson } from '../_launch.js'
import { OPEN } from '../_finish.js'
import { broadcastLaunch, broadcastSetup, saveTable, tableReady } from '../_pump.js'

type Pending = { message: string; setup: { table: string; expected: string[]; messages: string[] } | null; signature: string | null } & Record<string, unknown>

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'send', 20)
  if (slow) return slow
  const b = await readJson<{ mint?: unknown; tx?: unknown; setup?: unknown }>(req, 20_000)
  if (!b || !isAddress(b.mint) || typeof b.tx !== 'string') return noStore({ error: 'bad request' }, 400)
  const [raw] = await redis(['GET', keys.pending(b.mint)])
  const pending = parse<Pending>(raw)
  if (!pending) return noStore({ error: 'This launch expired. Try again.' }, 410)
  if (pending.signature) return noStore({ signature: pending.signature })
  let signature: string
  try {
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
    signature = await broadcastLaunch(b.tx, pending.message)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    console.error('launch send', msg)
    if (/blockhash|expired/i.test(msg)) return noStore({ error: 'The launch took too long to sign. Try again.' }, 400)
    if (/insufficient|0x1\b/i.test(msg)) return noStore({ error: 'Not enough SOL in this wallet for the launch and first buy.' }, 400)
    return noStore({ error: friendly(e) ?? 'The network rejected the launch. Nothing was spent, try again.' }, 400)
  }
  // The signed bytes are kept so the confirm step can re-send them until they land.
  await redis(['SET', keys.pending(b.mint), JSON.stringify({ ...pending, signature, raw: b.tx }), 'EX', 86_400], ['SADD', OPEN, b.mint])
  return noStore({ signature })
}
