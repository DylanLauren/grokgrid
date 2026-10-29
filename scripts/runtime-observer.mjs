#!/usr/bin/env node
// Deliberately no keypair loading, transaction building, signing, or broadcasting.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { fundState, validateRuntime } from './runtime-policy.mjs';
import { assertSnapshotProgress, assertPrivateRoot, readPrivateText, savePrivateJSON, withObservationJournal } from './runtime-observation-store.mjs';
import { captureLaunchRuleSnapshots } from './runtime-launch-rules.mjs';
import { phoneHeartbeat } from './runtime-ingest.mjs';
import { validateLaunchEvents, reconcileLaunchCheckpoint, LAUNCH_COVERAGE } from './runtime-launch-events.mjs';
const root=resolve(process.env.GROKGRID_RUNTIME_DIR||join(homedir(),'.config/grokgrid/runtime'));
const stateFile=join(root,'observer-status.json');
const origin='https://grokgrid-alpha.vercel.app';
let stop=false;
process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
async function get(path,token){const r=await fetch(origin+path,{headers:token?{Authorization:`Bearer ${token}`}:{ },redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('control-plane-unavailable');return r.json();}
async function run(){
  await assertPrivateRoot(root);
  const cfg=JSON.parse(await readPrivateText(join(root,'observer-config.json')));
  const conn=new Connection(cfg.rpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,confirmTransactionInitialTimeout:15000,
    fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000),redirect:'error'})});
  const pins={houseWallet:cfg.houseWallet,burnWallet:cfg.burnWallet};
  const checkpointFile=join(root,'launch-events-checkpoint.json');
  async function intake(token,afterCursor){
    try {
      const batch=validateLaunchEvents(await get(`/api/launch/events?after=${afterCursor}&limit=50`,token),afterCursor);
      return {queue:{free:null,launches:batch.events.map(({cursor:_cursor,...row})=>row)},launchEvents:{state:'durable',afterCursor,batch,historyComplete:false,coverage:LAUNCH_COVERAGE,executionEnabled:false,acknowledged:false}};
    } catch {
      let queue={free:null,launches:null};try{queue=await get('/api/ingest',token);}catch{}
      return {queue,launchEvents:{state:'degraded-legacy',afterCursor,reason:'durable-events-unavailable-or-invalid',historyComplete:false,coverage:'legacy-latest-window-only',executionEnabled:false,acknowledged:false}};
    }
  }
  async function observe(previous,afterCursor){
    const token=(await readPrivateText(resolve(cfg.tokenFile))).trim();
    const config=validateRuntime(await get('/api/runtime',token),cfg.houseWallet,cfg.burnWallet);
    const [snapshot,intakeResult]=await Promise.all([
      conn.getMultipleAccountsInfoAndContext([new PublicKey(config.houseWallet),new PublicKey(config.burnWallet)],{commitment:'finalized'}),intake(token,afterCursor),
    ]);
    const {queue,launchEvents}=intakeResult;
    const accounts=snapshot.value;
    if(!Number.isSafeInteger(snapshot.context.slot)||snapshot.context.slot<1)throw Error('balance-slot-unavailable');
    let mintVerified=false;
    if(config.officialMint){
      const mintKey=new PublicKey(config.officialMint),account=await conn.getAccountInfo(mintKey,'finalized');
      if(account&&[TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())){
        const mint=await getMint(conn,mintKey,'finalized',account.owner);
        mintVerified=mint.isInitialized&&mint.mintAuthority===null&&mint.freezeAuthority===null;
      }
    }
    const safeBalance=a=>{const n=a?.lamports??0;if(!Number.isSafeInteger(n)||n<0)throw Error('unsafe-balance');return String(n);};
    const burn=fundState({balanceLamports:safeBalance(accounts[1]),previousLamports:previous?.burn?.balanceLamports,mint:config.officialMint,mintVerified,reserveLamports:cfg.reserveLamports,thresholdLamports:cfg.thresholdLamports});
    const observation={observedAt:new Date().toISOString(),status:'observing',mode:'observe-only',signingEnabled:false,executionEnabled:false,
      balanceSlot:snapshot.context.slot,balanceCommitment:'finalized',previousSuccessfulAt:previous?.observedAt??null,
      house:{wallet:config.houseWallet,balanceLamports:safeBalance(accounts[0])},burn:{wallet:config.burnWallet,...burn},officialMint:config.officialMint||null,mintVerified,
      launchEvents,freeWallets:queue.free,pendingLaunches:Array.isArray(queue.launches)?queue.launches:null,strategy:'unvalidated-no-orders'};
    assertSnapshotProgress(previous,observation);
    try{observation.launchRules=await captureLaunchRuleSnapshots(root,{houseWallet:cfg.houseWallet,burnWallet:cfg.burnWallet},queue.launches,()=>get('/api/agents'));}
    catch{observation.launchRules={state:'unavailable',historyComplete:false,activePolicy:null,acknowledged:false,executionEnabled:false};}
    if(launchEvents.state==='durable'&&(observation.launchRules.state==='unavailable'||observation.launchRules.capacityReached||observation.launchRules.rejectedCount>0))launchEvents.state='durable-pending-rules';
    return observation;
  }
  do {
    try{
      const result=await withObservationJournal(root,{houseWallet:cfg.houseWallet,burnWallet:cfg.burnWallet},async journal=>{
        let checkpoint=null;
        try{checkpoint=JSON.parse(await readPrivateText(checkpointFile,4096));}catch(error){if(error.code!=='ENOENT')throw error;}
        // The fsynced journal is authoritative after a crash between append and checkpoint.
        const recovered=reconcileLaunchCheckpoint(checkpoint,pins,journal.launchCursor,journal.sequence);
        await savePrivateJSON(checkpointFile,recovered);
        let observation;
        try{observation=await observe(journal.lastSuccessful,journal.launchCursor);}catch{observation={observedAt:new Date().toISOString(),status:'unavailable',signingEnabled:false,executionEnabled:false};}
        const observationSequence=await journal.append(observation);
        await savePrivateJSON(checkpointFile,reconcileLaunchCheckpoint(null,pins,journal.launchCursor,observationSequence));
        // Append is durable before publishing the disposable latest-status view.
        const status={...observation,observationSequence};await savePrivateJSON(stateFile,status);return status;
      });
      console.log(JSON.stringify({at:result.observedAt,status:result.status,burnState:result.burn?.state,queued:result.pendingLaunches?.length,launchIntake:result.launchEvents?.state}));
      await phoneHeartbeat(root).catch(()=>{});
      if(result.status==='unavailable'&&process.argv.includes('--once'))process.exitCode=1;
    }catch(error){
      if(error?.code!=='OBSERVER_LOCKED')await savePrivateJSON(stateFile,{observedAt:new Date().toISOString(),status:'unavailable',signingEnabled:false,executionEnabled:false}).catch(()=>{});
      console.error('Observer unavailable; no action taken.');if(process.argv.includes('--once'))process.exitCode=1;
    }
    if(process.argv.includes('--once')||stop)break;
    await new Promise(r=>setTimeout(r,30000));
  }while(!stop);
}
// Raw parser/provider errors can contain protected configuration. Never print them.
run().catch(()=>{console.error('Observer unavailable; no action taken.');process.exitCode=1;});
