#!/usr/bin/env node
// Deliberately no keypair loading, transaction building, signing, or broadcasting.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { fundState, validateRuntime } from './runtime-policy.mjs';
import { assertSnapshotProgress, assertPrivateRoot, readPrivateText, savePrivateJSON, withObservationJournal } from './runtime-observation-store.mjs';
import { captureLaunchRuleSnapshots } from './runtime-launch-rules.mjs';
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
  async function observe(previous){
    const token=(await readPrivateText(resolve(cfg.tokenFile))).trim();
    const config=validateRuntime(await get('/api/runtime',token),cfg.houseWallet,cfg.burnWallet);
    const [snapshot,queue]=await Promise.all([
      conn.getMultipleAccountsInfoAndContext([new PublicKey(config.houseWallet),new PublicKey(config.burnWallet)],{commitment:'finalized'}),get('/api/ingest',token),
    ]);
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
      freeWallets:queue.free,pendingLaunches:Array.isArray(queue.launches)?queue.launches:null,strategy:'unvalidated-no-orders'};
    assertSnapshotProgress(previous,observation);
    try{observation.launchRules=await captureLaunchRuleSnapshots(root,{houseWallet:cfg.houseWallet,burnWallet:cfg.burnWallet},queue.launches,()=>get('/api/agents'));}
    catch{observation.launchRules={state:'unavailable',historyComplete:false,activePolicy:null,acknowledged:false,executionEnabled:false};}
    return observation;
  }
  do {
    try{
      const result=await withObservationJournal(root,{houseWallet:cfg.houseWallet,burnWallet:cfg.burnWallet},async journal=>{
        let observation;
        try{observation=await observe(journal.lastSuccessful);}catch{observation={observedAt:new Date().toISOString(),status:'unavailable',signingEnabled:false,executionEnabled:false};}
        const observationSequence=await journal.append(observation);
        // Append is durable before publishing the disposable latest-status view.
        const status={...observation,observationSequence};await savePrivateJSON(stateFile,status);return status;
      });
      console.log(JSON.stringify({at:result.observedAt,status:result.status,burnState:result.burn?.state,queued:result.pendingLaunches?.length}));
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
