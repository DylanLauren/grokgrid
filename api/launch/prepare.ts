// Builds an unsigned launch. Either the launching wallet is also this bot's trading wallet
// (v2), or the owner launches from their own wallet (Phantom) and the same approval funds the
// bot's separate trading wallet (v3). 80% of creator fees go to the trading wallet, 20% to the
// GRID burn wallet. No signing authority is granted by connecting a wallet, and unsigned
// prepares never reserve an owner.
import { randomUUID } from 'node:crypto'
import { balances, HOUSE_WALLET, hasStore, isAddress, parse, redis } from '../_lib.js'
import { BURN_WALLET, DRAFT_TTL, LEASE_TTL, cleanDraft, friendly, keys, launchStatus, limited, metadataJson, noStore, readJson, SITE_URL } from '../_launch.js'
import { launchOwnerState, releasePreparation, savePrepared } from '../_launch-owner.js'
import { prepareLaunch } from '../_pump.js'
import { verifiedWalletId } from '../_wallet-auth.js'

export { verifiedWalletId }
const MIN_LAUNCHER_SOL = 0.03
const MIN_FUND_SOL = 0.05 // the bot keeps a 0.02 reserve; this leaves it room to trade
const MAX_FUND_SOL = 10

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'prepare', 4)
  if (slow) return slow
  const status = await launchStatus()
  if (!status.open) return noStore({ error: status.reason }, 503)
  const b = await readJson<{ mint?: unknown; launcher?: unknown; bot?: unknown; fundSol?: unknown; draft?: unknown; walletId?: unknown }>(req, 8_000)
  if (!b || !isAddress(b.mint) || !isAddress(b.launcher)) return noStore({ error: 'bad request' }, 400)
  const mint=b.mint, launcher=b.launcher
  if(b.bot!==undefined&&!isAddress(b.bot))return noStore({error:'bad request'},400)
  const bot=(b.bot as string|undefined)??launcher, own=bot!==launcher
  if([launcher,bot].some(w=>w===BURN_WALLET||w===HOUSE_WALLET))return noStore({error:'The house and burn wallets are reserved for the platform.'},400)
  const fundSol=own?Number(b.fundSol):0
  if(own&&!(Number.isFinite(fundSol)&&fundSol>=MIN_FUND_SOL&&fundSol<=MAX_FUND_SOL))return noStore({error:`Fund your bot with ${MIN_FUND_SOL} to ${MAX_FUND_SOL} SOL.`},400)
  // The agent runner signs only from the Privy wallet proven here: owned by this user,
  // addressed to the bot's trading wallet, with our policy-scoped signer attached.
  const privyWalletId=await verifiedWalletId(req,b.walletId,bot)
  if(!privyWalletId)return noStore({error:'Verify your agent wallet setup again before launching.'},403)
  let draft
  try { draft=cleanDraft(b.draft) } catch(e){return noStore({error:friendly(e)??'Check the form.'},400)}
  // Advisory only. The authoritative, atomic owner claim occurs after a verified signature.
  const [owner,botOwner]=await Promise.all([launcher,bot].map(w=>launchOwnerState(w).catch(()=>({state:'review' as const}))))
  if(owner.state!=='available'||botOwner.state!=='available')return noStore({error:'This wallet already has an agent or a launch that needs review.',ownerState:owner},409)
  const [image,raw]=await redis(['EXISTS',keys.image(mint)],['GET',keys.pending(mint)])
  if(Number(image)!==1)return noStore({error:'Add the coin picture first.'},400)
  const existing=parse<{routingVersion:number;launcher:string;draft:unknown;tx:string;setup?:{txs?:string[]};sending?:boolean;signature?:string}>(raw)
  if(raw!==null&&raw!==undefined){
    if(existing?.routingVersion===(own?3:2)&&existing.launcher===launcher&&(existing as {bot?:string}).bot===bot&&JSON.stringify(existing.draft)===JSON.stringify(draft)&&typeof existing.tx==='string'&&!existing.sending&&!existing.signature)return noStore({tx:existing.tx,setup:existing.setup?.txs??null,bot,burn:BURN_WALLET})
    return noStore({error:'That coin address is already being prepared. Check its status before trying again.'},409)
  }
  const need=MIN_LAUNCHER_SOL+(Number(draft.firstBuy)||0)+fundSol,bal=(await balances([launcher]))[launcher]
  if(bal===undefined)return noStore({error:'Solana is slow right now. Try again in a moment.'},503)
  if(bal<need)return noStore({error:`This wallet needs at least ${need.toFixed(3)} SOL to launch.`},400)
  const routingVersion=own?3:2
  const reservation=JSON.stringify({routingVersion,launcher,preparing:true,nonce:randomUUID()})
  const [reserved]=await redis(['SET',keys.pending(mint),reservation,'NX','EX',LEASE_TTL])
  if(reserved!=='OK')return noStore({error:'That coin address is already being prepared. Try again shortly.'},409)
  try{
    await redis(['SET',keys.meta(mint),JSON.stringify(metadataJson(draft,mint)),'EX',DRAFT_TTL])
    const prepared=await prepareLaunch({launcher,mint,name:draft.name,ticker:draft.ticker,uri:`${SITE_URL}/m/${mint}`,firstBuy:draft.firstBuy,bot,burn:BURN_WALLET,fundLamports:BigInt(Math.round(fundSol*1e9))})
    const record={routingVersion,draft,launcher,bot,fundSol,burn:BURN_WALLET,privyWalletId,tx:prepared.tx,message:prepared.message,lastValidBlockHeight:prepared.lastValidBlockHeight,
      setup:prepared.setup?{table:prepared.setup.table,expected:prepared.setup.expected,messages:prepared.setup.messages,txs:prepared.setup.txs}:null,signature:null}
    if(!await savePrepared(mint,reservation,JSON.stringify(record),LEASE_TTL))return noStore({error:'This preparation expired before it completed. Try again.'},409)
    return noStore({tx:prepared.tx,setup:prepared.setup?.txs??null,bot,burn:BURN_WALLET})
  }catch(e){
    await releasePreparation(mint,reservation).catch(()=>{})
    const msg=friendly(e);if(!msg)console.error('Launch preparation failed.')
    return noStore({error:msg??'Something broke building the launch. Nothing was spent, try again.'},msg?400:500)
  }
}
