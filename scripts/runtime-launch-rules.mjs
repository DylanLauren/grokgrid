// Untrusted remote launch metadata becomes reviewable evidence, never an active policy.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readPrivateText, savePrivateJSON } from './runtime-observation-store.mjs';
const address=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(x)&&x!=='house';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function decimal(value,places,min,max){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('rule-number-invalid');
  const text=String(value),match=/^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text);
  if(!match||(match[2]?.length??0)>places)throw Error('rule-precision-unsupported');
  return (BigInt(match[1])*10n**BigInt(places)+BigInt((match[2]??'').padEnd(places,'0'))).toString();
}
function identity(row,now){
  if(!row||!id(row.id)||!address(row.wallet)||!address(row.mint)||!Number.isSafeInteger(row.ts)||row.ts<1||row.ts>now+300_000)throw Error('launch-identity-invalid');
  return {id:row.id,wallet:row.wallet,mint:row.mint,queuedAt:row.ts};
}
export function normalizeLaunchPolicy(entry,agent){
  if(!agent||agent.id!==entry.id||agent.wallet!==entry.wallet||agent.coin?.mint!==entry.mint)throw Error('registry-identity-conflict');
  // eslint-disable-next-line no-control-regex -- reject control characters in untrusted strategy text
  if(typeof agent.strategy!=='string'||!agent.strategy.trim()||Buffer.byteLength(agent.strategy)>140||/[\u0000-\u001f\u007f]/.test(agent.strategy))throw Error('strategy-description-invalid');
  const rules=agent.rules;
  if(!rules||Object.keys(rules).sort().join(',')!=='maxSol,stopLoss,takeProfit')throw Error('rule-schema-unsupported');
  return {policySchemaVersion:1,identity:{id:entry.id,wallet:entry.wallet,mint:entry.mint,queuedAt:entry.queuedAt},
    maxTradeLamports:decimal(rules.maxSol,9,0.01,10),takeProfitBasisPoints:decimal(rules.takeProfit,2,5,10000),stopLossBasisPoints:decimal(rules.stopLoss,2,1,95),
    strategyDescription:agent.strategy};
}
function empty(pins){return {version:1,...pins,revision:0,historyComplete:false,activePolicy:null,acknowledged:false,executionEnabled:false,entries:[]};}
export function planLaunchRuleSnapshots(previous,pins,queue,registry,now){
  const state=structuredClone(previous??empty(pins));
  if(!Number.isSafeInteger(now)||now<1||state.houseWallet!==pins.houseWallet||state.burnWallet!==pins.burnWallet)throw Error('launch-snapshot-invalid');
  const registryFresh=registry&&Array.isArray(registry.agents)&&registry.agents.length<=10000&&Number.isSafeInteger(registry.updatedAt)&&now-registry.updatedAt>=0&&now-registry.updatedAt<=90000;
  let rejected=0,capacityReached=false;
  if(Array.isArray(queue))for(const row of queue.slice(0,50)){
    let key;try{key=identity(row,now);}catch{rejected++;continue;}
    let entry=state.entries.find(x=>x.id===key.id);
    if(entry){if(entry.wallet!==key.wallet||entry.mint!==key.mint||entry.queuedAt!==key.queuedAt)entry.identityConflict=true;continue;}
    if(state.entries.length>=1000){capacityReached=true;continue;}
    const collisions=state.entries.filter(x=>x.wallet===key.wallet||x.mint===key.mint);
    collisions.forEach(x=>{x.identityConflict=true;});
    entry={...key,firstObservedAt:now,lastObservedAt:now,identityConflict:collisions.length>0||key.wallet===pins.houseWallet||key.wallet===pins.burnWallet,ruleChangeObserved:false,versions:[],state:'rules-unavailable'};
    state.entries.push(entry);
  }
  for(const entry of state.entries){
    entry.lastObservedAt=now;
    if(entry.identityConflict){entry.state='identity-conflict';continue;}
    const matches=registryFresh?registry.agents.filter(x=>x?.id===entry.id):[];
    if(matches.length>1){entry.identityConflict=true;entry.state='identity-conflict';continue;}
    if(!registryFresh||!matches.length){entry.state='rules-unavailable';continue;}
    if(matches[0].wallet!==entry.wallet||matches[0].coin?.mint!==entry.mint){entry.identityConflict=true;entry.state='identity-conflict';continue;}
    let policy;try{policy=normalizeLaunchPolicy(entry,matches[0]);}catch{entry.state='rules-invalid';continue;}
    const policyHash=hash(policy);
    entry.lastObservedPolicyHash=policyHash;entry.lastRegistryUpdatedAt=registry.updatedAt;
    if(!entry.versions.some(v=>v.policyHash===policyHash)){
      if(entry.versions.length){entry.ruleChangeObserved=true;}
      if(entry.versions.length>=32){capacityReached=true;entry.state='version-capacity-review-required';continue;}
      entry.versions.push({observationVersion:entry.versions.length+1,observedAt:now,source:'public-agent-registry',sourceUpdatedAt:registry.updatedAt,policyHash,policy});
    }
    entry.state=entry.ruleChangeObserved?'rule-change-review-required':'rules-observed-blocked';
  }
  state.revision++;state.observedAt=now;
  state.diagnostics={snapshotSchemaVersion:1,observedAt:now,queueAvailable:Array.isArray(queue),localQueueTruncated:Array.isArray(queue)&&queue.length>50,upstreamTruncationUnknown:true,registryFresh:!!registryFresh,rejectedCount:rejected,capacityReached,
    historyComplete:false,historyReason:'upstream-latest-50-without-cursor-or-ack',observedCount:state.entries.length,identityConflictCount:state.entries.filter(x=>x.identityConflict).length,
    rulesObservedCount:state.entries.filter(x=>x.versions.length>0).length,ruleChangeCount:state.entries.filter(x=>x.ruleChangeObserved).length,rulesUnavailableCount:state.entries.filter(x=>['rules-unavailable','rules-invalid','version-capacity-review-required'].includes(x.state)).length,activePolicy:null,acknowledged:false,executionEnabled:false};
  return state;
}
export async function captureLaunchRuleSnapshots(root,pins,queue,fetchRegistry,now){
  const path=join(root,'launch-rule-observations.json');let previous=null;
  try{
    const stored=JSON.parse(await readPrivateText(path,16*1024*1024));const {checksum,...body}=stored;
    if(checksum!==hash(body)||body.version!==1||!Number.isSafeInteger(body.revision)||body.revision<0||body.houseWallet!==pins.houseWallet||body.burnWallet!==pins.burnWallet||body.historyComplete!==false||body.activePolicy!==null||body.acknowledged!==false||body.executionEnabled!==false||!Array.isArray(body.entries)||body.entries.length>1000)throw Error('launch-snapshot-invalid');
    for(const entry of body.entries){
      identity({id:entry.id,wallet:entry.wallet,mint:entry.mint,ts:entry.queuedAt},now??Date.now());
      if(!Array.isArray(entry.versions)||entry.versions.length>32)throw Error('launch-snapshot-invalid');
      entry.versions.forEach((v,i)=>{if(v.observationVersion!==i+1||v.policyHash!==hash(v.policy)||v.policy.identity.id!==entry.id||v.policy.identity.wallet!==entry.wallet||v.policy.identity.mint!==entry.mint||v.policy.identity.queuedAt!==entry.queuedAt)throw Error('launch-snapshot-invalid');});
    }
    if(new Set(body.entries.map(x=>x.id)).size!==body.entries.length)throw Error('launch-snapshot-invalid');
    previous=body;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let registry=null;
  if((Array.isArray(queue)&&queue.length)||previous?.entries.length)try{registry=await fetchRegistry();}catch{}
  const state=planLaunchRuleSnapshots(previous,pins,queue,registry,now??Date.now());
  if(Buffer.byteLength(JSON.stringify(state))>15*1024*1024)throw Error('launch-snapshot-capacity');
  await savePrivateJSON(path,{...state,checksum:hash(state)});
  return state.diagnostics;
}
