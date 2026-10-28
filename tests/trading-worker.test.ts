import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// @ts-expect-error Shared Node runtime modules
import { emptyTradingState, validateTradingPolicy, planIntent, expireIntents, holdExternalSubmission, reconcileHeldIntent } from '../scripts/trading-policy.mjs'
// @ts-expect-error Shared Node runtime modules
import { withTradingStore } from '../scripts/trading-store.mjs'
const wallet = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const mint = 'E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq'
const now = Date.parse('2026-10-28T20:00:00Z')
const policy = { version:1, mode:'observe-only', executionEnabled:false, signingEnabled:false, agentId:'house', wallet, allowedMints:[mint], maxTradeLamports:'100', maxExposureLamports:'200', maxDailyLossLamports:'50', reserveLamports:'10', maxSlippageBps:100, maxPendingIntents:3, maxIntentAgeMs:60000 }
const observer = { observedAt:new Date(now).toISOString(), status:'observing', mode:'observe-only', executionEnabled:false, signingEnabled:false, house:{wallet,balanceLamports:'1000'} }
const risk = { wallet, complete:true, exposureLamports:'0', dailyLossLamports:'0', utcDay:'2026-10-28', observedAt:now }
const proposal = {id:'order-1',agentId:'house',wallet,mint,side:'buy',spendLamports:'100',slippageBps:100,createdAt:now,expiresAt:now+60000}
const signature = '3'.repeat(88)
const plan = (s=emptyTradingState(policy), input=proposal, obs=observer, r=risk) => planIntent(s,policy,input,obs,r,now)

test('valid hypothetical proposal remains blocked and identical retry is idempotent',()=>{
 const s=plan(); assert.equal(s.intents[0].state,'blocked-execution-disabled');assert.equal(s.executionEnabled,false);assert.equal(s.signingEnabled,false)
 assert.equal(plan(s),s)
 assert.throws(()=>plan(s,{...proposal,spendLamports:'99'}),/Idempotency/)
})
test('policy rejects enabled execution, invalid addresses and impossible limits; empty allowlist is valid',()=>{
 assert.throws(()=>validateTradingPolicy({...policy,executionEnabled:true}));assert.throws(()=>validateTradingPolicy({...policy,wallet:'1'.repeat(44)}));assert.throws(()=>validateTradingPolicy({...policy,maxExposureLamports:'99'}))
 assert.deepEqual(validateTradingPolicy({...policy,allowedMints:[]}).allowedMints,[])
 assert.throws(()=>planIntent(emptyTradingState({...policy,allowedMints:[]}),{...policy,allowedMints:[]},proposal,observer,risk,now))
})
test('wallet, mint, time, slippage and integer amount checks fail closed',()=>{
 for(const bad of [{wallet:mint},{mint:wallet},{agentId:'other'},{side:'sell'},{createdAt:now+1},{expiresAt:now},{expiresAt:now+60001},{spendLamports:'1.2'},{spendLamports:'0'},{slippageBps:101}])assert.throws(()=>plan(undefined,{...proposal,...bad}))
})
test('missing, stale, future or wrong-wallet observations and risk do not create an intent',()=>{
 for(const obs of [{...observer,observedAt:new Date(now-90001).toISOString()},{...observer,observedAt:new Date(now+1).toISOString()},{...observer,house:{wallet:mint,balanceLamports:'1000'}},{...observer,status:'unavailable'}])assert.throws(()=>plan(undefined,proposal,obs))
 for(const r of [{...risk,complete:false},{...risk,utcDay:'2026-10-27'},{...risk,observedAt:now-90001},{...risk,wallet:mint}])assert.throws(()=>plan(undefined,proposal,observer,r))
})
test('reserved proposals count toward balance and exposure, and daily loss stops planning',()=>{
 const one=plan(),two=plan(one,{...proposal,id:'order-2'});assert.equal(two.intents.length,2)
 assert.throws(()=>plan(two,{...proposal,id:'order-3'}),/limit/)
 assert.throws(()=>plan(undefined,proposal,{...observer,house:{wallet,balanceLamports:'109'}}),/limit/)
 assert.throws(()=>plan(undefined,proposal,observer,{...risk,dailyLossLamports:'50'}),/limit/)
 assert.throws(()=>plan(undefined,proposal,observer,{...risk,exposureLamports:'101'}),/limit/)
})
test('unsubmitted expiry releases reservation but unknown external submission never expires or retries',()=>{
 const s=plan();assert.equal(expireIntents(s,now+60000).intents[0].state,'expired')
 const held=holdExternalSubmission(s,policy,proposal.id,signature)
 assert.equal(expireIntents(held,now+600000).intents[0].state,'held-ambiguous')
 assert.throws(()=>plan(held,{...proposal,id:'order-2'}),/Unresolved/)
 assert.throws(()=>holdExternalSubmission(held,policy,proposal.id,'4'.repeat(88)),/cannot change/)
})
test('unknown or mismatched reconciliation remains held; only matching finalized evidence resolves',async()=>{
 const held=holdExternalSubmission(plan(),policy,proposal.id,signature)
 const receipt={signature,wallet,mint,finality:'finalized',slot:123,outcome:'confirmed',spentLamports:'100',receivedTokenUnits:'200'}
 for(const evidence of [null,{...receipt,finality:'confirmed'},{...receipt,wallet:mint},{...receipt,signature:'4'.repeat(88)},{...receipt,spentLamports:'101'},{...receipt,receivedTokenUnits:'0'}])assert.equal(await reconcileHeldIntent(held,policy,proposal.id,async()=>evidence),held)
 assert.equal(await reconcileHeldIntent(held,policy,proposal.id,async()=>{throw Error('RPC unavailable')}),held)
 const confirmed=await reconcileHeldIntent(held,policy,proposal.id,async()=>receipt)
 assert.equal(confirmed.intents[0].state,'reconciled-confirmed');assert.equal(confirmed.executionEnabled,false)
 const failed=await reconcileHeldIntent(held,policy,proposal.id,async()=>({...receipt,outcome:'failed'}));assert.equal(failed.intents[0].state,'reconciled-failed')
})
test('durable store survives restart and refuses policy drift or corrupt state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokgrid-trading-'))
 try{
  await withTradingStore(root,policy,()=>holdExternalSubmission(plan(),policy,proposal.id,signature))
  const restarted=await withTradingStore(root,policy,(s:any)=>s);assert.equal(restarted.intents[0].state,'held-ambiguous')
  await assert.rejects(withTradingStore(root,{...policy,wallet:mint},(s:any)=>s),/mismatch/)
  await writeFile(join(root,'trading-journal.json'),'{broken',{mode:0o600})
  await assert.rejects(withTradingStore(root,policy,(s:any)=>s))
  assert.equal(await readFile(join(root,'trading-journal.json'),'utf8'),'{broken')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('single writer lock and private file permissions are enforced',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokgrid-lock-'))
 try{
  await writeFile(join(root,'trading.lock'),'existing',{mode:0o600})
  await assert.rejects(withTradingStore(root,policy,(s:any)=>s),/locked/)
  await rm(join(root,'trading.lock'));await withTradingStore(root,policy,(s:any)=>s)
  await chmod(join(root,'trading-journal.json'),0o644)
  await assert.rejects(withTradingStore(root,policy,(s:any)=>s),/private/)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('CLI observes pinned house locally without any signer and rejects unknown arguments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokgrid-cli-'));const run=promisify(execFile)
 try{
  await writeFile(join(root,'trading-config.json'),JSON.stringify({...policy,allowedMints:[]}),{mode:0o600})
  await writeFile(join(root,'observer-status.json'),JSON.stringify({...observer,observedAt:new Date().toISOString(),pendingLaunches:[]}),{mode:0o600})
  await run(process.execPath,['scripts/trading-worker.mjs','--once'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}})
  const status=JSON.parse(await readFile(join(root,'trading-status.json'),'utf8'));assert.equal(status.status,'observing-execution-disabled');assert.equal(status.executionEnabled,false);assert.equal(status.automaticLaunchesEnabled,false)
  await assert.rejects(run(process.execPath,['scripts/trading-worker.mjs','--enable'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}}))
 }finally{await rm(root,{recursive:true,force:true})}
})
