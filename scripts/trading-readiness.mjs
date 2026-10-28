import { publicAddress } from './trading-policy.mjs';
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
export function observerIsFresh(policy, observation, now) {
  const at=Date.parse(observation?.observedAt);
  return observation?.status==='observing'&&observation.mode==='observe-only'&&observation.house?.wallet===policy.wallet&&integer(observation.house?.balanceLamports)&&observation.executionEnabled===false&&observation.signingEnabled===false&&Number.isFinite(at)&&now-at>=0&&now-at<=90000;
}
export function positionsAreFresh(policy, positions, now) {
  return positions?.wallet===policy.wallet&&positions.complete===true&&positions.source==='finalized-rpc-token-accounts'&&positions.commitment==='finalized'&&Number.isSafeInteger(positions.observedAt)&&now-positions.observedAt>=0&&now-positions.observedAt<=90000&&Array.isArray(positions.contextSlots)&&positions.contextSlots.length===2&&positions.contextSlots.every(x=>Number.isSafeInteger(x)&&x>0)&&Array.isArray(positions.positions)&&positions.positions.every(x=>publicAddress(x.mint)&&integer(x.tokenUnits)&&integer(x.spendableTokenUnits)&&BigInt(x.spendableTokenUnits)<=BigInt(x.tokenUnits))&&new Set(positions.positions.map(x=>x.mint)).size===positions.positions.length;
}
export function positionRefreshPlan(policy, attempt, positions, now, force=false) {
  if(force)return {refresh:true,reason:'explicit-refresh',nextAttemptAt:now};
  if(attempt?.wallet!==policy.wallet||!Number.isSafeInteger(attempt.lastAttemptAt)||attempt.lastAttemptAt>now||attempt.lastAttemptAt<=0||!Number.isSafeInteger(attempt.failures)||attempt.failures<0||!['started','success','unavailable'].includes(attempt.outcome)||attempt.outcome==='unavailable'&&attempt.failures<1)return {refresh:true,reason:'no-valid-attempt',nextAttemptAt:now};
  const delay=attempt.outcome==='unavailable'?Math.min(300000,60000*2**Math.min(attempt.failures-1,3)):60000;
  const nextAttemptAt=attempt.lastAttemptAt+delay;
  return {refresh:now>=nextAttemptAt,reason:now>=nextAttemptAt?'scheduled-refresh':positionsAreFresh(policy,positions,now)?'fresh-cache':'retry-backoff',nextAttemptAt};
}
export function tradingReadiness(policy,observation,positions,state,now) {
  const observerFresh=observerIsFresh(policy,observation,now),inventoryFresh=positionsAreFresh(policy,positions,now);
  const blockers=['execution-disabled','signer-unavailable','strategy-unvalidated','accounting-unverified'];
  if(!observerFresh)blockers.push('wallet-observation-unavailable');
  else if(BigInt(observation.house.balanceLamports)<=BigInt(policy.reserveLamports))blockers.push('spendable-sol-unavailable');
  if(!inventoryFresh)blockers.push('finalized-inventory-unavailable');
  if(!policy.allowedMints.length)blockers.push('mint-allowlist-empty');
  if(state.intents.some(i=>i.state==='held-ambiguous'))blockers.push('unresolved-submission');
  if((state.launchesObserved??[]).some(i=>i.state==='identity-conflict'))blockers.push('launch-identity-conflict');
  return {readyForLiveTrading:false,executionEnabled:false,signingEnabled:false,observerFresh,inventoryFresh,inventoryComplete:inventoryFresh?true:null,inventoryMintCount:inventoryFresh?positions.positions.length:null,costBasisVerified:false,riskAccountingVerified:false,blockers};
}
// Only durable local observation. No external queue read/write, acknowledgment,
// agent creation, key assignment, rule approval or execution occurs here.
export function observeLaunchQueue(state,policy,queue,now) {
  if(!Number.isSafeInteger(now)||now<=0||!Array.isArray(queue))return {state,rejectedCount:0,queueUnavailable:true,truncated:false,capacityReached:false};
  let entries=structuredClone(state.launchesObserved??[]),changed=false,rejectedCount=0,capacityReached=false;
  const markConflict=entry=>{if(entry.state!=='identity-conflict'){entry.state='identity-conflict';changed=true;}};
  for(const row of queue.slice(0,50)) {
    if(!row||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(row.id)||row.id===policy.agentId||!publicAddress(row.mint)||!publicAddress(row.wallet)||!Number.isSafeInteger(row.ts)||row.ts<=0||row.ts>now){rejectedCount++;continue;}
    const existing=entries.find(i=>i.id===row.id);
    if(existing){if(existing.wallet!==row.wallet||existing.mint!==row.mint||existing.queuedAt!==row.ts)markConflict(existing);continue;}
    if(entries.length>=1000){capacityReached=true;continue;}
    const collision=entries.filter(i=>i.wallet===row.wallet||i.mint===row.mint);
    for(const entry of collision)markConflict(entry);
    entries.push({id:row.id,wallet:row.wallet,mint:row.mint,queuedAt:row.ts,firstObservedAt:now,state:collision.length||row.wallet===policy.wallet?'identity-conflict':'observed-blocked',rules:'not-fetched',acknowledged:false,executionEnabled:false});changed=true;
  }
  return {state:changed?{...state,revision:state.revision+1,launchesObserved:entries}:state,rejectedCount,queueUnavailable:false,truncated:queue.length>50,capacityReached};
}
