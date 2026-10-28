import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
// @ts-expect-error Node runtime
import { observerIsFresh, positionsAreFresh, positionRefreshPlan, tradingReadiness, observeLaunchQueue } from '../scripts/trading-readiness.mjs'
// @ts-expect-error Node runtime
import { emptyTradingState,validateTradingState } from '../scripts/trading-policy.mjs'
// @ts-expect-error Node runtime
import { withTradingStore } from '../scripts/trading-store.mjs'
const wallet='GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT',mint='E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq',bot='3F59imZbLqz4GW5F2TijmU2oSrQC8gakzovTPy4tYrLQ'
const now=1793217600000
const policy={version:1,mode:'observe-only',executionEnabled:false,signingEnabled:false,agentId:'house',wallet,allowedMints:[],maxTradeLamports:'100',maxExposureLamports:'100',maxDailyLossLamports:'50',reserveLamports:'10',maxSlippageBps:100,maxPendingIntents:3,maxIntentAgeMs:60000}
const observation={observedAt:new Date(now).toISOString(),status:'observing',mode:'observe-only',executionEnabled:false,signingEnabled:false,house:{wallet,balanceLamports:'0'},pendingLaunches:[]}
const positions={wallet,complete:true,source:'finalized-rpc-token-accounts',commitment:'finalized',observedAt:now,contextSlots:[123,124],positions:[],costBasisVerified:false}
test('periodic inventory refresh survives process restarts and backs off failure without implying zero',()=>{
 assert.equal(positionRefreshPlan(policy,null,null,now).refresh,true)
 const attempt={wallet,lastAttemptAt:now,failures:0,outcome:'success'}
 assert.equal(positionRefreshPlan(policy,attempt,positions,now+59999).refresh,false)
 assert.equal(positionRefreshPlan(policy,attempt,positions,now+60000).refresh,true)
 assert.equal(positionRefreshPlan(policy,attempt,positions,now+1,true).refresh,true)
 const failed={...attempt,failures:3,outcome:'unavailable'}
 assert.equal(positionRefreshPlan(policy,failed,null,now+239999).refresh,false)
 assert.equal(positionRefreshPlan(policy,failed,null,now+240000).refresh,true)
 assert.equal(positionRefreshPlan(policy,{...attempt,lastAttemptAt:now+1},positions,now).refresh,true)
})
test('readiness distinguishes verified empty inventory from stale/failed data and never implies trading readiness',()=>{
 const state=emptyTradingState(policy),r=tradingReadiness(policy,observation,positions,state,now)
 assert.equal(r.inventoryMintCount,0);assert.equal(r.inventoryFresh,true);assert.equal(r.readyForLiveTrading,false);assert.equal(r.costBasisVerified,false);assert.equal(r.riskAccountingVerified,false)
 assert.ok(r.blockers.includes('spendable-sol-unavailable'));assert.ok(r.blockers.includes('mint-allowlist-empty'))
 const stale=tradingReadiness(policy,observation,{...positions,observedAt:now-90001},state,now)
 assert.equal(stale.inventoryMintCount,null);assert.equal(stale.inventoryComplete,null)
 assert.equal(positionsAreFresh(policy,{...positions,complete:false},now),false)
 assert.equal(observerIsFresh(policy,{...observation,house:{wallet,balanceLamports:'-1'}},now),false)
})
test('launch intake is durable, idempotent, nonacknowledging, and holds immutable identity changes',async()=>{
 const row={id:'bot-one',mint,wallet:bot,ts:now-1000};const initial=emptyTradingState(policy)
 const first=observeLaunchQueue(initial,policy,[row],now).state;assert.equal(first.launchesObserved[0].state,'observed-blocked');assert.equal(first.launchesObserved[0].acknowledged,false);assert.equal(first.launchesObserved[0].rules,'not-fetched')
 assert.equal(observeLaunchQueue(first,policy,[row],now+1000).state,first)
 const conflict=observeLaunchQueue(first,policy,[{...row,wallet}],now+2000).state;assert.equal(conflict.launchesObserved[0].wallet,bot);assert.equal(conflict.launchesObserved[0].state,'identity-conflict')
 const root=await mkdtemp(join(tmpdir(),'grokgrid-intake-'))
 try{await withTradingStore(root,policy,()=>conflict);const again=await withTradingStore(root,policy,(s:any)=>s);assert.equal(again.launchesObserved[0].state,'identity-conflict');assert.equal(again.executionEnabled,false)}finally{await rm(root,{recursive:true,force:true})}
})
test('reused wallets and invalid launch records never become execution-ready',()=>{
 const row={id:'bot-one',mint,wallet:bot,ts:now-1000}
 const one=observeLaunchQueue(emptyTradingState(policy),policy,[row],now).state
 const result=observeLaunchQueue(one,policy,[{...row,id:'bot-two'}, {id:'house',mint,wallet,ts:now-1000},{...row,id:'future',ts:now+1}],now)
 assert.equal(result.rejectedCount,2);assert.ok(result.state.launchesObserved.every((r:any)=>r.state==='identity-conflict'&&!r.acknowledged&&!r.executionEnabled))
 const invalid=structuredClone(result.state);invalid.launchesObserved[0].acknowledged=true;assert.throws(()=>validateTradingState(invalid,policy))
})
test('CLI preserves backoff and writes truthful readiness without connection credentials or fabricated accounting',async()=>{
 const root=await mkdtemp(join(tmpdir(),'grokgrid-ready-')),run=promisify(execFile)
 try{
  await writeFile(join(root,'trading-config.json'),JSON.stringify(policy),{mode:0o600})
  await writeFile(join(root,'observer-status.json'),JSON.stringify({...observation,observedAt:new Date().toISOString()}),{mode:0o600})
  // Missing RPC config is an unavailable inventory, not a zero-wallet assertion.
  await run(process.execPath,['scripts/trading-worker.mjs','--once'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}})
  const first=JSON.parse(await readFile(join(root,'trading-position-refresh.json'),'utf8'))
  await run(process.execPath,['scripts/trading-worker.mjs','--once'],{env:{...process.env,GROKGRID_RUNTIME_DIR:root}})
  const second=JSON.parse(await readFile(join(root,'trading-position-refresh.json'),'utf8'));assert.equal(second.lastAttemptAt,first.lastAttemptAt)
  const status=JSON.parse(await readFile(join(root,'trading-status.json'),'utf8'));assert.equal(status.readiness.inventoryMintCount,null);assert.equal(status.readiness.readyForLiveTrading,false);assert.equal(status.launchIntake.acknowledged,false)
 }finally{await rm(root,{recursive:true,force:true})}
})
