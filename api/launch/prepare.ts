// Builds the unsigned launch for the visitor's wallet. The browser adds the mint's signature
// and the wallet's, then hands it to /api/launch/send. 80% of the coin's creator fees go to a
// fresh trading wallet Grok Bot made for this bot, 20% to the $GRID burn wallet.
import { hasStore, isAddress, redis } from '../_lib.js'
import { BURN_WALLET, DRAFT_TTL, cleanDraft, friendly, keys, launchStatus, leaseWallet, limited, metadataJson, noStore, readJson, SITE_URL } from '../_launch.js'
import { prepareLaunch } from '../_pump.js'

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'prepare', 12)
  if (slow) return slow
  const status = await launchStatus()
  if (!status.open) return noStore({ error: status.reason }, 503)
  const b = await readJson<{ mint?: unknown; launcher?: unknown; draft?: unknown }>(req, 8_000)
  if (!b || !isAddress(b.mint) || !isAddress(b.launcher)) return noStore({ error: 'bad request' }, 400)
  const mint = b.mint
  let draft
  try {
    draft = cleanDraft(b.draft)
  } catch (e) {
    return noStore({ error: friendly(e) ?? 'Check the form.' }, 400)
  }
  const [image, pending] = await redis(['EXISTS', keys.image(mint)], ['EXISTS', keys.pending(mint)])
  if (Number(image) !== 1) return noStore({ error: 'Add the coin picture first.' }, 400)
  if (Number(pending) === 1) return noStore({ error: 'That coin address is taken. Try again for a fresh one.' }, 409)

  const bot = await leaseWallet(mint)
  if (!bot) return noStore({ error: 'Grok Bot is making new trading wallets. Try again in a few minutes.' }, 503)
  try {
    await redis(['SET', keys.meta(mint), JSON.stringify(metadataJson(draft, mint)), 'EX', DRAFT_TTL])
    const prepared = await prepareLaunch({ launcher: b.launcher, mint, name: draft.name, ticker: draft.ticker, uri: `${SITE_URL}/m/${mint}`, firstBuy: draft.firstBuy, bot, burn: BURN_WALLET })
    const record = { draft, launcher: b.launcher, bot, burn: BURN_WALLET, message: prepared.message, lastValidBlockHeight: prepared.lastValidBlockHeight, setup: prepared.setup && { table: prepared.setup.table, expected: prepared.setup.expected, messages: prepared.setup.messages }, signature: null }
    await redis(['SET', keys.pending(mint), JSON.stringify(record), 'EX', 3600])
    return noStore({ tx: prepared.tx, setup: prepared.setup?.txs ?? null, bot, burn: BURN_WALLET })
  } catch (e) {
    await redis(['DEL', keys.lease(bot)]).catch(() => {})
    const msg = friendly(e)
    if (!msg) console.error('launch prepare', e)
    return noStore({ error: msg ?? 'Something broke building the launch. Nothing was spent, try again.' }, msg ? 400 : 500)
  }
}
