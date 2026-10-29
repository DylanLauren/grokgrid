#!/usr/bin/env node
// Observation/planning worker. In 'observe-only' it never signs. In an explicit 'execute'
// policy it signs at most one planned intent per tick, journals it, then broadcasts.
import { open, rename, mkdir, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import { validateTradingPolicy, expireIntents, planIntent, reconcileHeldIntent, dropExpiredSubmission, executes } from './trading-policy.mjs';
import { journalRisk, signNext } from './trading-executor.mjs';
import { heartbeat } from './runtime-ingest.mjs';
import { connect, readMint, buildBuy, buildSell, loadSigner, signatureStatus, signedSignature } from './pump-chain.mjs';
import { createFinalizedReceiptVerifier } from './trading-reconcile.mjs';
import { collectFinalizedPositions } from './trading-positions.mjs';
import { observerIsFresh, positionRefreshPlan, tradingReadiness, observeLaunchQueue } from './trading-readiness.mjs';
import { withTradingStore } from './trading-store.mjs';
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const args = process.argv.slice(2), proposalAt=args.indexOf('--proposal');
if (args.filter(x=>x==='--proposal').length>1 || args.some((x,i)=>!['--once','--reconcile','--refresh-positions','--proposal'].includes(x) && !(proposalAt>=0&&i===proposalAt+1)) || proposalAt>=0 && (!args[proposalAt+1] || args[proposalAt+1].startsWith('--'))) {
  console.error('Usage: trading-worker.mjs [--once] [--reconcile] [--refresh-positions] [--proposal /path/to/proposal.json]'); process.exit(1);
}
let stop=false;const shutdown=new AbortController();
for(const name of ['SIGTERM','SIGINT'])process.on(name,()=>{stop=true;shutdown.abort();});
const ownedPrivate = s => (!process.getuid || s.uid===process.getuid()) && (s.mode&0o077)===0;
async function assertRoot() {
  await mkdir(root,{recursive:true,mode:0o700});const s=await lstat(root);
  if(!s.isDirectory() || s.isSymbolicLink() || !ownedPrivate(s))throw Error('Runtime directory must be private and owned');
}
async function json(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const s=await handle.stat();if(!s.isFile()||!ownedPrivate(s)||s.size>8*1024*1024)throw Error('Runtime input must be private and owned');
    return JSON.parse(await handle.readFile('utf8'));
  } finally {await handle.close();}
}
async function savePrivate(name,value) {
  const destination=join(root,name);
  try {const s=await lstat(destination);if(!s.isFile()||s.isSymbolicLink()||!ownedPrivate(s))throw Error('Runtime output must be private and owned');}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=join(root,`.${name}.${randomUUID()}.tmp`);let handle;
  try {handle=await open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();await handle.close();handle=null;await rename(tmp,destination);}
  finally {if(handle)await handle.close();await unlink(tmp).catch(()=>{});}
}
async function tick() {
  await assertRoot();const policy=validateTradingPolicy(await json(join(root,'trading-config.json')));
  let observation;try{observation=await json(join(root,'observer-status.json'));}catch{observation=null;}
  let connection;
  async function rpcUrl() {if(!connection){connection=await json(join(root,'observer-config.json'));if(connection.houseWallet!==policy.wallet)throw Error('RPC wallet mismatch');}return connection.rpcUrl;}
  const proposal=proposalAt>=0?await json(resolve(args[proposalAt+1])):null;
  let positions=null,attempt=null,positionsRefreshed=false;
  let launchIntake={rejectedCount:0,queueUnavailable:true,truncated:false,capacityReached:false};
  let execution={reason:'observe-only'},pendingSend=null;
  const state=await withTradingStore(join(root,'trading'),policy,async s=>{
    try{positions=await json(join(root,'trading-positions.json'));}catch{}
    try{attempt=await json(join(root,'trading-position-refresh.json'));}catch{}
    const refresh=positionRefreshPlan(policy,attempt,positions,Date.now(),args.includes('--refresh-positions')||proposal?.side==='sell');
    if(refresh.refresh) {
      const lastAttemptAt=Date.now(),failures=attempt?.wallet===policy.wallet&&Number.isSafeInteger(attempt.failures)?Math.max(0,Math.min(attempt.failures,10)):0;
      await savePrivate('trading-position-refresh.json',{wallet:policy.wallet,lastAttemptAt,failures,outcome:'started'});
      try{positions=await collectFinalizedPositions(await rpcUrl(),policy.wallet);}catch{positions=null;}
      positionsRefreshed=positions?.complete===true;
      await savePrivate('trading-positions.json',positions??{observedAt:Date.now(),wallet:policy.wallet,complete:false,status:'unavailable',costBasisVerified:false});
      attempt={wallet:policy.wallet,lastAttemptAt,failures:positionsRefreshed?0:failures+1,outcome:positionsRefreshed?'success':'unavailable'};
      await savePrivate('trading-position-refresh.json',attempt);
    }
    s=expireIntents(s,Date.now());
    if(observerIsFresh(policy,observation,Date.now())){const intake=observeLaunchQueue(s,policy,observation.pendingLaunches,Date.now());s=intake.state;const {state:ignored,...diagnostics}=intake;launchIntake=diagnostics;}
    if(args.includes('--reconcile')&&s.intents.some(i=>i.state==='held-ambiguous')) {
      const verify=createFinalizedReceiptVerifier(await rpcUrl());
      for(const intent of s.intents.filter(i=>i.state==='held-ambiguous'))s=await reconcileHeldIntent(s,policy,intent.id,verify);
    }
    if(executes(policy)) {
      const conn=connect(await rpcUrl());
      for(const intent of s.intents.filter(i=>i.state==='held-ambiguous'&&Number.isSafeInteger(i.lastValidBlockHeight)))
        s=dropExpiredSubmission(s,policy,intent.id,await signatureStatus(conn,intent.signature),await conn.getBlockHeight('finalized'));
    }
    // Execute mode sizes risk from its own journal (conservatively); observe mode keeps the external snapshot.
    if(proposal)s=planIntent(s,policy,proposal,observation,proposal.side==='buy'?(executes(policy)?journalRisk(s,policy.wallet,Date.now()):await json(join(root,'trading-risk.json'))):null,Date.now(),positions);
    if(executes(policy)) {
      const conn=connect(await rpcUrl());
      const stopFilePresent=await access(policy.stopFile).then(()=>true,()=>false);
      let signer=null;
      const signed=await signNext(s,policy,{stopFilePresent,signatureOf:signedSignature,
        sign:tx=>tx.sign([signer]),
        build:async intent=>{
          signer??=await loadSigner(policy.keypairFile,policy.wallet);
          const {tokenProgram}=await readMint(conn,intent.mint);
          return intent.side==='buy'?buildBuy(conn,{wallet:policy.wallet,mint:intent.mint,spendLamports:intent.spendLamports,slippageBps:intent.slippageBps,tokenProgram})
            :buildSell(conn,{wallet:policy.wallet,mint:intent.mint,tokenUnits:intent.tokenUnits,minimumReceiveLamports:intent.minimumReceiveLamports,slippageBps:intent.slippageBps,tokenProgram});
        }},Date.now());
      s=signed.state;execution={reason:signed.reason,intentId:signed.intentId??null};
      if(signed.tx)pendingSend={conn,tx:signed.tx};
    }
    return s;
  });
  // The signature is durable in the journal now; only then broadcast. A send error leaves it held.
  if(pendingSend)try{await pendingSend.conn.sendRawTransaction(pendingSend.tx.serialize(),{skipPreflight:false,preflightCommitment:'finalized',maxRetries:0});execution.broadcast='sent';}catch{execution.broadcast='error-held';}
  const now=Date.now(), age=observation?now-Date.parse(observation.observedAt):NaN;
  const readiness=tradingReadiness(policy,observation,positions,state,now),observerFresh=readiness.observerFresh;
  const nextRefresh=positionRefreshPlan(policy,attempt,positions,now);
  const status={observedAt:new Date(now).toISOString(),mode:policy.mode,executionEnabled:policy.executionEnabled,signingEnabled:policy.signingEnabled,execution,status:!observerFresh?'observer-unavailable':executes(policy)?'executing':'observing-execution-disabled',agentId:policy.agentId,wallet:policy.wallet,observerFresh,observerAgeMs:Number.isFinite(age)?age:null,journalRevision:state.revision,intents:state.intents.map(i=>({id:i.id,mint:i.mint,side:i.side,state:i.state})),pendingLaunchesObserved:observerFresh&&Array.isArray(observation.pendingLaunches)?observation.pendingLaunches.length:null,strategy:'unvalidated-no-orders',automaticLaunchesEnabled:false,reconciliationEnabled:args.includes('--reconcile'),positionsRefreshed,readiness,positionRefresh:{outcome:attempt?.outcome??'unavailable',nextAttemptAt:nextRefresh.nextAttemptAt},launchIntake:{...launchIntake,observedCount:(state.launchesObserved??[]).length,acknowledged:false,executionEnabled:false}};
  await savePrivate('trading-status.json',status);
  await heartbeat(root,'trading',{mode:executes(policy)?'execute':'observe-only',healthy:observerFresh,note:execution.reason});
  console.log(JSON.stringify({status:status.status,revision:state.revision,intents:state.intents.length,executionEnabled:policy.executionEnabled}));
}
do {
  try{await tick();}catch(error){
    // Raw provider errors, input contents and paths may contain credentials.
    if(error?.code!=='TRADING_LOCKED')try{await assertRoot();await savePrivate('trading-status.json',{observedAt:new Date().toISOString(),status:'unavailable',executionEnabled:false,signingEnabled:false});}catch{}
    await heartbeat(root,'trading',{mode:'observe-only',healthy:false,note:'tick failed'});
    console.error('Trading observer unavailable; no execution attempted. Inspect private configuration and journal.');
    if(args.includes('--once')||proposalAt>=0)process.exitCode=1;
  }
  if(args.includes('--once')||proposalAt>=0||stop)break;
  try{await delay(30000,undefined,{signal:shutdown.signal});}catch{}
}while(!stop);
