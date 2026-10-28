import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error Node runtime module
import { createFinalizedReceiptVerifier, inspectFinalizedIntentReceipt } from '../scripts/trading-reconcile.mjs'
// @ts-expect-error Node runtime module
import { validateTradingState, emptyTradingState, planIntent, holdExternalSubmission, reconcileHeldIntent } from '../scripts/trading-policy.mjs'
const wallet='GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT',mint='E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq',ata='3F59imZbLqz4GW5F2TijmU2oSrQC8gakzovTPy4tYrLQ'
const signature='3'.repeat(88), now=1793217600000
const intent={signature,wallet,mint,side:'buy',spendLamports:'100',createdAt:now,expiresAt:now+60000}
const status={confirmationStatus:'finalized',slot:123,err:null}
const token={accountIndex:1,mint,owner:wallet,uiTokenAmount:{amount:'200',decimals:6}}
const tx:any={slot:123,blockTime:now/1000,transaction:{signatures:[signature],message:{accountKeys:[{pubkey:wallet,signer:true},{pubkey:ata,signer:false},{pubkey:mint,signer:false}]}},meta:{err:null,fee:5,preBalances:[10000,0,0],postBalances:[9893,2,0],preTokenBalances:[],postTokenBalances:[token]}}
const copy=()=>structuredClone(tx)
test('receipt independently matches finalized signature/slot and exact SOL flow excluding fee and ATA rent',()=>{
 const r=inspectFinalizedIntentReceipt(intent,status,tx);assert.equal(r.outcome,'confirmed');assert.equal(r.spentLamports,'100');assert.equal(r.receivedTokenUnits,'200')
 for(const change of [{signature:'4'.repeat(88)},{wallet:mint},{mint:wallet},{spendLamports:'99'},{createdAt:now+1000},{expiresAt:now-1000}])assert.equal(inspectFinalizedIntentReceipt({...intent,...change},status,tx),null)
 assert.equal(inspectFinalizedIntentReceipt(intent,{...status,confirmationStatus:'confirmed'},tx),null)
 assert.equal(inspectFinalizedIntentReceipt(intent,{...status,slot:124},tx),null)
})
test('ambiguous, unrelated assets, owner mutation, malformed balances and wrong receipts stay unresolved',()=>{
 const bads=[]
 let t=copy();t.transaction.signatures[0]='4'.repeat(88);bads.push(t)
 t=copy();t.transaction.message.accountKeys[0].signer=false;bads.push(t)
 t=copy();t.meta.postTokenBalances[0].uiTokenAmount.amount='0';bads.push(t)
 t=copy();t.meta.postTokenBalances[0].accountIndex=99;bads.push(t)
 t=copy();t.meta.postBalances[0]=9892;bads.push(t)
 t=copy();t.meta.preTokenBalances=[{...token,owner:mint,uiTokenAmount:{amount:'0',decimals:6}}];bads.push(t)
 t=copy();t.meta.postTokenBalances.push({...token,accountIndex:2,mint:ata});bads.push(t)
 t=copy();t.meta.postTokenBalances.push({...token});bads.push(t)
 t=copy();t.meta.postBalances[0]=Number.MAX_SAFE_INTEGER+1;bads.push(t)
 for(const invalid of bads)assert.equal(inspectFinalizedIntentReceipt(intent,status,invalid),null)
})
test('failed finalized receipt requires the same signed wallet, mint, signature and matching error',()=>{
 const failed=copy();failed.meta.err={InstructionError:[1,'Custom']};const state={...status,err:failed.meta.err}
 assert.equal(inspectFinalizedIntentReceipt(intent,state,failed).outcome,'failed')
 assert.equal(inspectFinalizedIntentReceipt(intent,status,failed),null)
 failed.transaction.message.accountKeys[0].signer=false;assert.equal(inspectFinalizedIntentReceipt(intent,state,failed),null)
})
test('RPC adapter requests only read methods with finalized commitment and does not expose errors',async()=>{
 const calls:any[]=[]
 const fetcher=async(_url:string,options:any)=>{const body=JSON.parse(options.body);calls.push(body);assert.equal(options.redirect,'error');return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='getSignatureStatuses'?{value:[status]}:tx}))}
 const verify=createFinalizedReceiptVerifier('https://rpc.example.test/?api-key=redacted-test',fetcher)
 assert.equal((await verify(intent)).outcome,'confirmed')
 assert.deepEqual(calls.map(x=>x.method),['getSignatureStatuses','getTransaction']);assert.equal(calls[0].params[0][0],signature);assert.equal(calls[1].params[0],signature);assert.equal(calls[1].params[1].commitment,'finalized')
 const failing=createFinalizedReceiptVerifier('https://rpc.example.test',async()=>{throw Error('secret-like error')});assert.equal(await failing(intent),null)
 const unfinalized=createFinalizedReceiptVerifier('https://rpc.example.test',async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{value:[{...status,confirmationStatus:'processed'}]}})));assert.equal(await unfinalized(intent),null)
 assert.throws(()=>createFinalizedReceiptVerifier('http://rpc.example.test'))
})
test('saved reconciled state rejects a mismatched receipt even with a valid journal structure',async()=>{
 const p={version:1,mode:'observe-only',executionEnabled:false,signingEnabled:false,agentId:'house',wallet,allowedMints:[mint],maxTradeLamports:'100',maxExposureLamports:'100',maxDailyLossLamports:'100',reserveLamports:'1',maxSlippageBps:10,maxPendingIntents:1,maxIntentAgeMs:60000}
 const proposal={...intent,id:'one',agentId:'house',slippageBps:10};const obs={observedAt:new Date(now).toISOString(),status:'observing',mode:'observe-only',executionEnabled:false,signingEnabled:false,house:{wallet,balanceLamports:'1000'}};const risk={wallet,complete:true,exposureLamports:'0',dailyLossLamports:'0',utcDay:new Date(now).toISOString().slice(0,10),observedAt:now}
 let s=planIntent(emptyTradingState(p),p,proposal,obs,risk,now);s=holdExternalSubmission(s,p,'one',signature);s=await reconcileHeldIntent(s,p,'one',async()=>inspectFinalizedIntentReceipt(intent,status,tx));assert.equal(s.intents[0].state,'reconciled-confirmed')
 s.intents[0].receipt.spentLamports='99';assert.throws(()=>validateTradingState(s,p),/receipt/)
})
