// Sends the signed launch, but only if it is still exactly the one we built.
import { VersionedMessage } from '@solana/web3.js'
import { hasStore, isAddress, parse, redis } from '../_lib.js'
import { friendly, keys, limited, noStore, readJson } from '../_launch.js'
import { claimLaunchOwner } from '../_launch-owner.js'
import { authorizedLaunch } from '../_verify.js'
import { OPEN, routable } from '../_finish.js'
import { validationTables, broadcastLaunch, broadcastSetup, saveTable, tableReady } from '../_pump.js'

type Pending = { routingVersion?: number; launcher?: string; bot: string; message: string; setup: { table: string; expected: string[]; messages: string[] } | null; signature: string | null } & Record<string, unknown>

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'send', 20)
  if (slow) return slow
  const b = await readJson<{ mint?: unknown; tx?: unknown; setup?: unknown }>(req, 20_000)
  if (!b || !isAddress(b.mint) || typeof b.tx !== 'string') return noStore({ error: 'bad request' }, 400)
  const [raw] = await redis(['GET', keys.pending(b.mint)])
  const pending = parse<Pending>(raw)
  if (!pending || !isAddress(pending.bot) || typeof pending.message !== 'string') return noStore({ error: 'This launch expired. Try again.' }, 410)
  if(!isAddress(pending.launcher)||!routable(pending))return noStore({error:'This older launch requires review. Do not submit it again.'},409)
  if (pending.signature) return noStore({ signature: pending.signature })
  if (pending.sending) return noStore({ error: 'This launch is already being submitted. Check its status before retrying.' }, 409)
  let signature: string
  let ownerClaimed=false
  try {
    const preparedPayer=VersionedMessage.deserialize(Buffer.from(pending.message,'base64')).staticAccountKeys[0]?.toBase58()
    if(preparedPayer!==pending.launcher)return noStore({error:'The prepared transaction does not belong to this launching wallet. Nothing was submitted.'},400)
    signature = authorizedLaunch(b.tx, pending.message, await validationTables(pending.message, pending.setup))
    if(pending.setup&&(!Array.isArray(b.setup)||b.setup.length!==pending.setup.messages.length||!b.setup.every(s=>typeof s==='string')))return noStore({error:'The lookup-table approval is missing. Nothing was submitted.'},400)
    const recovery = JSON.stringify({ ...pending, signature: null, authorizedSignature: signature, raw: b.tx, sending: true, phase: 'setup-pending' })
    if (!(await claimLaunchOwner(pending.launcher, b.mint, raw as string, recovery))) return noStore({ error: 'This wallet already has an agent or another signed launch in progress. Check its status.' }, 409)
    ownerClaimed=true
    // The coin may land at any moment now, so its picture and metadata must not expire.
    await redis(['PERSIST', keys.image(b.mint)], ['PERSIST', keys.meta(b.mint)])
    // The site's first launch also opens its lookup table, in the same approval.
    if (pending.setup && !(await tableReady(pending.setup.table, pending.setup.expected))) {
      if (!Array.isArray(b.setup) || !b.setup.every((s) => typeof s === 'string')) return noStore({ error: 'This signed launch requires review. Check its status before any further action.' }, 409)
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
    await redis(['SET', keys.pending(b.mint), JSON.stringify({ ...pending, signature, raw: b.tx, sending: true, phase: 'launch-submitted' })])
    signature = await broadcastLaunch(b.tx, pending.message)
  } catch (e) {
    if(ownerClaimed)return noStore({error:'This signed launch is held for reconciliation. Check its status and wallet activity; do not create another launch.'},409)
    const msg = (e as Error).message ?? ''
    console.error('Launch submission requires review.')
    if (/blockhash|expired/i.test(msg)) return noStore({ error: 'The launch took too long to sign. Try again.' }, 400)
    if (/insufficient|0x1\b/i.test(msg)) return noStore({ error: 'Not enough SOL in this wallet for the launch and first buy.' }, 400)
    return noStore({ error: friendly(e) ?? 'The network rejected the launch. Check your wallet activity before retrying.' }, 400)
  }
  // The signed bytes are kept so the confirm step can re-send them until they land.
  await redis(['SET', keys.pending(b.mint), JSON.stringify({ ...pending, signature, raw: b.tx, sending: true, phase: 'launch-submitted' })], ['SADD', OPEN, b.mint])
  return noStore({ signature })
}
