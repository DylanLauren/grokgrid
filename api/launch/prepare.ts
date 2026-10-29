// Builds an unsigned launch. The launching wallet is also this bot's trading wallet:
// 80% creator fees return to it, 20% go to the GRID burn wallet. No signing authority
// is granted by connecting a wallet, and unsigned prepares never reserve an owner.
import { randomUUID } from 'node:crypto'
import { balances, HOUSE_WALLET, hasStore, isAddress, parse, redis } from '../_lib.js'
import { BURN_WALLET, DRAFT_TTL, LEASE_TTL, cleanDraft, friendly, keys, launchStatus, limited, metadataJson, noStore, readJson, SITE_URL } from '../_launch.js'
import { launchOwnerState, releasePreparation, savePrepared } from '../_launch-owner.js'
import { prepareLaunch } from '../_pump.js'
const MIN_LAUNCHER_SOL = 0.03

export async function POST(req: Request) {
  if (!hasStore()) return noStore({ error: 'The launchpad is offline for a moment, try again soon.' }, 503)
  const slow = await limited(req, 'prepare', 4)
  if (slow) return slow
  const status = await launchStatus()
  if (!status.open) return noStore({ error: status.reason }, 503)
  const b = await readJson<{ mint?: unknown; launcher?: unknown; draft?: unknown }>(req, 8_000)
  if (!b || !isAddress(b.mint) || !isAddress(b.launcher)) return noStore({ error: 'bad request' }, 400)
  const mint=b.mint, launcher=b.launcher
  if(launcher===BURN_WALLET||launcher===HOUSE_WALLET)return noStore({error:'The house and burn wallets are reserved for the platform.'},400)
  let draft
  try { draft=cleanDraft(b.draft) } catch(e){return noStore({error:friendly(e)??'Check the form.'},400)}
  // Advisory only. The authoritative, atomic owner claim occurs after a verified signature.
  const owner=await launchOwnerState(launcher).catch(()=>({state:'review' as const}))
  if(owner.state!=='available')return noStore({error:'This wallet already has an agent or a launch that needs review.',ownerState:owner},409)
  const [image,raw]=await redis(['EXISTS',keys.image(mint)],['GET',keys.pending(mint)])
  if(Number(image)!==1)return noStore({error:'Add the coin picture first.'},400)
  const existing=parse<{routingVersion:number;launcher:string;draft:unknown;tx:string;setup?:{txs?:string[]};sending?:boolean;signature?:string}>(raw)
  if(raw!==null&&raw!==undefined){
    if(existing?.routingVersion===2&&existing.launcher===launcher&&JSON.stringify(existing.draft)===JSON.stringify(draft)&&typeof existing.tx==='string'&&!existing.sending&&!existing.signature)return noStore({tx:existing.tx,setup:existing.setup?.txs??null,bot:launcher,burn:BURN_WALLET})
    return noStore({error:'That coin address is already being prepared. Check its status before trying again.'},409)
  }
  const need=MIN_LAUNCHER_SOL+(Number(draft.firstBuy)||0),bal=(await balances([launcher]))[launcher]
  if(bal===undefined)return noStore({error:'Solana is slow right now. Try again in a moment.'},503)
  if(bal<need)return noStore({error:`This wallet needs at least ${need.toFixed(3)} SOL to launch.`},400)
  const reservation=JSON.stringify({routingVersion:2,launcher,preparing:true,nonce:randomUUID()})
  const [reserved]=await redis(['SET',keys.pending(mint),reservation,'NX','EX',LEASE_TTL])
  if(reserved!=='OK')return noStore({error:'That coin address is already being prepared. Try again shortly.'},409)
  try{
    await redis(['SET',keys.meta(mint),JSON.stringify(metadataJson(draft,mint)),'EX',DRAFT_TTL])
    const prepared=await prepareLaunch({launcher,mint,name:draft.name,ticker:draft.ticker,uri:`${SITE_URL}/m/${mint}`,firstBuy:draft.firstBuy,bot:launcher,burn:BURN_WALLET})
    const record={routingVersion:2,draft,launcher,bot:launcher,burn:BURN_WALLET,tx:prepared.tx,message:prepared.message,lastValidBlockHeight:prepared.lastValidBlockHeight,
      setup:prepared.setup?{table:prepared.setup.table,expected:prepared.setup.expected,messages:prepared.setup.messages,txs:prepared.setup.txs}:null,signature:null}
    if(!await savePrepared(mint,reservation,JSON.stringify(record),LEASE_TTL))return noStore({error:'This preparation expired before it completed. Try again.'},409)
    return noStore({tx:prepared.tx,setup:prepared.setup?.txs??null,bot:launcher,burn:BURN_WALLET})
  }catch(e){
    await releasePreparation(mint,reservation).catch(()=>{})
    const msg=friendly(e);if(!msg)console.error('Launch preparation failed.')
    return noStore({error:msg??'Something broke building the launch. Nothing was spent, try again.'},msg?400:500)
  }
}
