import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, realpath, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeLaunchPolicy, planLaunchRuleSnapshots, captureLaunchRuleSnapshots } from '../scripts/runtime-launch-rules.mjs'
const now=1700000000000
const pins={houseWallet:'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT',burnWallet:'E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq'}
const row={id:'test-bot',wallet:'11111111111111111111111111111111',mint:'So11111111111111111111111111111111111111112',ts:now-100}
const agent={id:row.id,wallet:row.wallet,coin:{mint:row.mint},strategy:'Research description only',rules:{maxSol:0.125,takeProfit:25.5,stopLoss:10}}
const registry=(a=agent)=>({updatedAt:now,agents:[a]})
test('exact normalized rules are versioned and bound but never activated or acknowledged',()=>{
  const first=planLaunchRuleSnapshots(null,pins,[row],registry(),now)
  const v=first.entries[0].versions[0]
  assert.equal(v.policy.maxTradeLamports,'125000000');assert.equal(v.policy.takeProfitBasisPoints,'2550');assert.equal(v.observationVersion,1);assert.match(v.policyHash,/^[0-9a-f]{64}$/)
  assert.equal(first.activePolicy,null);assert.equal(first.executionEnabled,false);assert.equal(first.acknowledged,false);assert.equal(first.historyComplete,false)
  const again=planLaunchRuleSnapshots(first,pins,[row],registry(),now+1);assert.equal(again.entries[0].versions.length,1)
  assert.equal(first.entries[0].lastObservedAt,now)
})
test('identity collisions and registry mismatch are sticky, never retarget a pinned wallet or mint',()=>{
  const first=planLaunchRuleSnapshots(null,pins,[row],registry(),now)
  const mismatch=planLaunchRuleSnapshots(first,pins,[{...row,wallet:pins.houseWallet}],registry(),now+1)
  assert.equal(mismatch.entries[0].wallet,row.wallet);assert.equal(mismatch.entries[0].state,'identity-conflict')
  assert.equal(planLaunchRuleSnapshots(mismatch,pins,[row],registry(),now+2).entries[0].state,'identity-conflict')
  const reused=planLaunchRuleSnapshots(first,pins,[{...row,id:'other'}],registry(),now+1);assert.equal(reused.diagnostics.identityConflictCount,2)
  assert.equal(planLaunchRuleSnapshots(first,pins,[row],registry({...agent,wallet:pins.burnWallet}),now+1).entries[0].state,'identity-conflict')
})
test('changed rules preserve old versions and require review even when remote rules revert',()=>{
  const first=planLaunchRuleSnapshots(null,pins,[row],registry(),now)
  const changed=planLaunchRuleSnapshots(first,pins,[row],registry({...agent,rules:{...agent.rules,maxSol:0.25}}),now+1)
  assert.equal(changed.entries[0].versions.length,2);assert.equal(changed.entries[0].versions[0].policy.maxTradeLamports,'125000000')
  const reverted=planLaunchRuleSnapshots(changed,pins,[row],registry(),now+2)
  assert.equal(reverted.entries[0].state,'rule-change-review-required');assert.equal(reverted.entries[0].versions.length,2);assert.equal(reverted.entries[0].lastObservedPolicyHash,reverted.entries[0].versions[0].policyHash)
})
test('invalid precision, unknown fields, text controls and stale/absent registry stay blocked',()=>{
  const entry={...row,queuedAt:row.ts}
  for(const a of [{...agent,rules:{...agent.rules,maxSol:0.1000000001}},{...agent,rules:{...agent.rules,takeProfit:25.555}},{...agent,rules:{...agent.rules,leverage:10}},{...agent,strategy:'bad\ncontrol'}])assert.throws(()=>normalizeLaunchPolicy(entry,a))
  const first=planLaunchRuleSnapshots(null,pins,[row],registry(),now)
  for(const r of [null,{...registry(),updatedAt:now-90001}]){
    const state=planLaunchRuleSnapshots(first,pins,[],r,now+1);assert.equal(state.entries[0].state,'rules-unavailable');assert.equal(state.entries[0].versions.length,1);assert.equal(state.historyComplete,false)
  }
})
test('durable restart retains versions; empty queue does not erase history or claim complete delivery',async()=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'launch-rules-'))
  try{
    let calls=0
    await captureLaunchRuleSnapshots(root,pins,[],async()=>{calls++;return registry()},now);assert.equal(calls,0)
    await captureLaunchRuleSnapshots(root,pins,[row],async()=>registry(),now)
    const result=await captureLaunchRuleSnapshots(root,pins,[],async()=>{throw Error('offline')},now+1)
    assert.equal(result.observedCount,1);assert.equal(result.registryFresh,false);assert.equal(result.historyComplete,false)
    const stored=JSON.parse(await readFile(join(root,'launch-rule-observations.json'),'utf8'));assert.equal(stored.entries[0].versions.length,1);assert.equal(stored.activePolicy,null)
  }finally{await rm(root,{recursive:true,force:true})}
})


test('queue gaps and duplicate registry identities remain explicit blockers',()=>{
  const state=planLaunchRuleSnapshots(null,pins,[row],{updatedAt:now,agents:[agent,agent]},now)
  assert.equal(state.entries[0].state,'identity-conflict')
  const unavailable=planLaunchRuleSnapshots(null,pins,null,null,now)
  assert.equal(unavailable.diagnostics.queueAvailable,false)
  assert.equal(unavailable.diagnostics.upstreamTruncationUnknown,true)
  assert.equal(unavailable.historyComplete,false)
  const fifty=planLaunchRuleSnapshots(null,pins,Array(50).fill(row),registry(),now)
  assert.equal(fifty.historyComplete,false)
})

test('registry freshness uses completion time, not the time before an asynchronous fetch',async()=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'launch-rules-fresh-'))
  try{
    const result=await captureLaunchRuleSnapshots(root,pins,[row],async()=>{
      await new Promise(resolve=>setTimeout(resolve,5))
      return {updatedAt:Date.now(),agents:[agent]}
    })
    assert.equal(result.registryFresh,true);assert.equal(result.rulesObservedCount,1)
  }finally{await rm(root,{recursive:true,force:true})}
})
