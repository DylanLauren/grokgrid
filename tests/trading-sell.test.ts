import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile,chmod,rm,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// @ts-expect-error Node runtime
import { emptyTradingState,planIntent,expireIntents,holdExternalSubmission,reconcileHeldIntent } from '../scripts/trading-policy.mjs'
// @ts-expect-error Node runtime
import { inspectPositionResponses,collectFinalizedPositions } from '../scripts/trading-positions.mjs'
// @ts-expect-error Node runtime
import { inspectFinalizedIntentReceipt } from '../scripts/trading-reconcile.mjs'
const wallet='GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT',mint='E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq',ata='3F59imZbLqz4GW5F2TijmU2oSrQC8gakzovTPy4tYrLQ',program='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const now=1793217600000,signature='3'.repeat(88)
const policy={version:1,mode:'observe-only',executionEnabled:false,signingEnabled:false,agentId:'house',wallet,allowedMints:[mint],maxTradeLamports:'100',maxExposureLamports:'100',maxDailyLossLamports:'50',reserveLamports:'10',maxSlippageBps:100,maxPendingIntents:3,maxIntentAgeMs:60000}
const observer={observedAt:new Date(now).toISOString(),status:'observing',mode:'observe-only',executionEnabled:false,signingEnabled:false,house:{wallet,balanceLamports:'1000'}}
const proposal={id:'exit-1',agentId:'house',wallet,mint,side:'sell',tokenUnits:'60',tokenDecimals:6,minimumReceiveLamports:'100',slippageBps:50,createdAt:now,expiresAt:now+60000}
const row={pubkey:ata,account:{owner:program,data:{parsed:{type:'account',info:{owner:wallet,mint,state:'initialized',isNative:false,tokenAmount:{amount:'100',decimals:6}}}}}}
const responses=[{context:{slot:123},value:[row]},{context:{slot:124},value:[]}]
const positions=inspectPositionResponses(wallet,responses,now)
const plan=(s=emptyTradingState(policy),p=proposal,snapshot=positions)=>planIntent(s,policy,p,observer,null,now,snapshot)
test('sell planning uses actual raw units and stays disabled without inventing cost basis or daily loss',()=>{
 const s=plan();assert.equal(s.intents[0].state,'blocked-execution-disabled');assert.equal(s.intents[0].tokenUnits,'60');assert.equal(s.intents[0].spendLamports,undefined);assert.equal(positions.costBasisVerified,false)
 // A risk-reducing exit does not require invented PnL or block on a loss cap.
 const loss={wallet,complete:true,exposureLamports:'9999',dailyLossLamports:'9999',utcDay:'2026-10-28',observedAt:now}
 assert.equal(planIntent(emptyTradingState(policy),policy,proposal,observer,loss,now,positions).intents.length,1)
 for(const snapshot of [null,{...positions,complete:false},{...positions,observedAt:now-90001},{...positions,wallet:mint},{...positions,positions:[]}])assert.throws(()=>plan(undefined,proposal,snapshot))
 assert.throws(()=>plan(undefined,{...proposal,tokenDecimals:9}))
 assert.throws(()=>plan(undefined,{...proposal,tokenUnits:'101'}))
 assert.throws(()=>plan(undefined,{...proposal,minimumReceiveLamports:'0'}))
})
test('same-mint sell reservations prevent overselling, ambiguous sell does not expire, finalized failure releases only reservation',async()=>{
 const first=plan();assert.throws(()=>plan(first,{...proposal,id:'exit-2',tokenUnits:'41'}))
 assert.equal(plan(first,{...proposal,id:'exit-2',tokenUnits:'40'}).intents.length,2)
 const held=holdExternalSubmission(first,policy,proposal.id,signature);assert.equal(expireIntents(held,now+999999).intents[0].state,'held-ambiguous');assert.throws(()=>plan(held,{...proposal,id:'exit-2',tokenUnits:'1'}))
 const failed=await reconcileHeldIntent(held,policy,proposal.id,async()=>({signature,wallet,mint,finality:'finalized',slot:123,outcome:'failed'}));assert.equal(plan(failed,{...proposal,id:'exit-2',tokenUnits:'100'}).intents.length,2)
 assert.equal(positions.positions[0].tokenUnits,'100');assert.equal(failed.executionEnabled,false)
})
test('finalized position reader rejects incomplete/foreign/malformed data and does not mark frozen/delegated/extension tokens spendable',()=>{
 assert.equal(positions.positions[0].spendableTokenUnits,'100')
 assert.equal(inspectPositionResponses(wallet,[responses[0]],now),null)
 for(const patch of [{owner:mint},{tokenAmount:{amount:'-1',decimals:6}}]){const r=structuredClone(responses);Object.assign(r[0].value[0].account.data.parsed.info,patch);assert.equal(inspectPositionResponses(wallet,r,now),null)}
 for(const patch of [{state:'frozen'},{delegate:mint},{extensions:[{extension:'transferFeeAmount'}]}]){const r=structuredClone(responses);Object.assign(r[0].value[0].account.data.parsed.info,patch);const v=inspectPositionResponses(wallet,r,now);assert.equal(v.positions[0].tokenUnits,'100');assert.equal(v.positions[0].spendableTokenUnits,'0')}
 const duplicate=structuredClone(responses);duplicate[0].value.push(row);assert.equal(inspectPositionResponses(wallet,duplicate,now),null)
})
test('position RPC uses both finalized token programs; one provider failure never becomes zero inventory',async()=>{
 const calls:any[]=[];const fetcher=async(_url:string,init:any)=>{const b=JSON.parse(init.body);calls.push(b);return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:responses[b.id-1]}))}
 const result=await collectFinalizedPositions('https://rpc.example.test',wallet,fetcher);assert.equal(result.positions[0].tokenUnits,'100');assert.equal(calls.length,2);assert.ok(calls.every(b=>b.method==='getTokenAccountsByOwner'&&b.params[2].commitment==='finalized'))
 assert.equal(await collectFinalizedPositions('https://rpc.example.test',wallet,async()=>new Response('',{status:503})),null)
})
test('sell reconciliation requires exact token units and minimum real SOL proceeds, excluding closed-account rent and fees',()=>{
 const intent={...proposal,signature};const token={accountIndex:1,owner:wallet,mint,uiTokenAmount:{amount:'60',decimals:6}}
 const tx={slot:123,blockTime:now/1000,transaction:{signatures:[signature],message:{accountKeys:[{pubkey:wallet,signer:true},{pubkey:ata,signer:false},{pubkey:mint,signer:false}]}},meta:{err:null,fee:5,preBalances:[1000,2,0],postBalances:[1097,0,0],preTokenBalances:[token],postTokenBalances:[]}}
 const status={slot:123,confirmationStatus:'finalized',err:null};const r=inspectFinalizedIntentReceipt(intent,status,tx);assert.equal(r.soldTokenUnits,'60');assert.equal(r.receivedLamports,'100')
 assert.equal(inspectFinalizedIntentReceipt({...intent,tokenUnits:'59'},status,tx),null);assert.equal(inspectFinalizedIntentReceipt({...intent,minimumReceiveLamports:'101'},status,tx),null);assert.equal(inspectFinalizedIntentReceipt({...intent,tokenDecimals:9},status,tx),null)
})
test('CLI refuses public-readable or symlinked configuration and writes no fixed shared temp',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokgrid-private-')),run=promisify(execFile)
 try{
  const cfg=join(root,'trading-config.json');await writeFile(cfg,JSON.stringify(policy),{mode:0o600});await chmod(cfg,0o644)
  await assert.rejects(run(process.execPath,['scripts/trading-worker.mjs','--once'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}}))
  assert.equal(JSON.parse(await readFile(join(root,'trading-status.json'),'utf8')).executionEnabled,false)
  await chmod(cfg,0o600);await writeFile(join(root,'actual.json'),JSON.stringify(policy),{mode:0o600});await rm(cfg);await symlink(join(root,'actual.json'),cfg)
  await assert.rejects(run(process.execPath,['scripts/trading-worker.mjs','--once'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}}))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('Token-2022 holdings are recorded but not marked spendable without mint-extension inspection',()=>{
 const r:any=structuredClone(responses);r[0].value=[];r[1].value=[structuredClone(row)];r[1].value[0].account.owner='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
 const p=inspectPositionResponses(wallet,r,now);assert.equal(p.positions[0].tokenUnits,'100');assert.equal(p.positions[0].spendableTokenUnits,'0');assert.throws(()=>plan(undefined,proposal,p))
})
test('a snapshot older than a finalized receipt cannot reuse pre-sale inventory',async()=>{
 let s=holdExternalSubmission(plan(),policy,proposal.id,signature)
 s=await reconcileHeldIntent(s,policy,proposal.id,async()=>({signature,wallet,mint,finality:'finalized',slot:125,outcome:'confirmed',soldTokenUnits:'60',receivedLamports:'100'}))
 assert.throws(()=>plan(s,{...proposal,id:'exit-2',tokenUnits:'40'}),/predates/)
 const fresh={...positions,contextSlots:[125,125],positions:[{...positions.positions[0],tokenUnits:'40',spendableTokenUnits:'40'}]}
 assert.equal(plan(s,{...proposal,id:'exit-2',tokenUnits:'40'},fresh).intents.length,2)
})
test('lock contention leaves another worker healthy status untouched',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokgrid-contention-')),run=promisify(execFile)
 try{
  await writeFile(join(root,'trading-config.json'),JSON.stringify(policy),{mode:0o600})
  const {mkdir}=await import('node:fs/promises');await mkdir(join(root,'trading'),{mode:0o700});await writeFile(join(root,'trading','trading.lock'),'existing',{mode:0o600})
  const healthy=JSON.stringify({status:'observing-execution-disabled',executionEnabled:false});await writeFile(join(root,'trading-status.json'),healthy,{mode:0o600})
  await assert.rejects(run(process.execPath,['scripts/trading-worker.mjs','--once'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}}))
  assert.equal(await readFile(join(root,'trading-status.json'),'utf8'),healthy)
 }finally{await rm(root,{recursive:true,force:true})}
})
