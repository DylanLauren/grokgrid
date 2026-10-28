#!/usr/bin/env node
// Observation/planning worker. Optional read-only RPC; no signing or broadcast.
import { open, rename, mkdir, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { validateTradingPolicy, expireIntents, planIntent, reconcileHeldIntent } from './trading-policy.mjs';
import { createFinalizedReceiptVerifier } from './trading-reconcile.mjs';
import { collectFinalizedPositions } from './trading-positions.mjs';
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
  let positions=null;
  if(args.includes('--refresh-positions')||proposal?.side==='sell') {
    positions=await collectFinalizedPositions(await rpcUrl(),policy.wallet);
    await savePrivate('trading-positions.json',positions??{observedAt:Date.now(),wallet:policy.wallet,complete:false,status:'unavailable',costBasisVerified:false});
  }
  const state=await withTradingStore(join(root,'trading'),policy,async s=>{
    s=expireIntents(s,Date.now());
    if(args.includes('--reconcile')&&s.intents.some(i=>i.state==='held-ambiguous')) {
      const verify=createFinalizedReceiptVerifier(await rpcUrl());
      for(const intent of s.intents.filter(i=>i.state==='held-ambiguous'))s=await reconcileHeldIntent(s,policy,intent.id,verify);
    }
    if(proposal)s=planIntent(s,policy,proposal,observation,proposal.side==='buy'?await json(join(root,'trading-risk.json')):null,Date.now(),positions);
    return s;
  });
  const now=Date.now(), age=observation?now-Date.parse(observation.observedAt):NaN;
  const observerFresh=observation?.status==='observing'&&observation.mode==='observe-only'&&observation.house?.wallet===policy.wallet&&observation.executionEnabled===false&&observation.signingEnabled===false&&Number.isFinite(age)&&age>=0&&age<=90000;
  const status={observedAt:new Date(now).toISOString(),mode:'observe-only',executionEnabled:false,signingEnabled:false,status:observerFresh?'observing-execution-disabled':'observer-unavailable',agentId:policy.agentId,wallet:policy.wallet,observerFresh,observerAgeMs:Number.isFinite(age)?age:null,journalRevision:state.revision,intents:state.intents.map(i=>({id:i.id,mint:i.mint,side:i.side,state:i.state})),pendingLaunchesObserved:observerFresh&&Array.isArray(observation.pendingLaunches)?observation.pendingLaunches.length:null,strategy:'unvalidated-no-orders',automaticLaunchesEnabled:false,reconciliationEnabled:args.includes('--reconcile'),positionsRefreshed:positions?.complete===true};
  await savePrivate('trading-status.json',status);console.log(JSON.stringify({status:status.status,revision:state.revision,intents:state.intents.length,executionEnabled:false}));
}
do {
  try{await tick();}catch(error){
    // Raw provider errors, input contents and paths may contain credentials.
    if(error?.code!=='TRADING_LOCKED')try{await assertRoot();await savePrivate('trading-status.json',{observedAt:new Date().toISOString(),status:'unavailable',executionEnabled:false,signingEnabled:false});}catch{}
    console.error('Trading observer unavailable; no execution attempted. Inspect private configuration and journal.');
    if(args.includes('--once')||proposalAt>=0)process.exitCode=1;
  }
  if(args.includes('--once')||proposalAt>=0||stop)break;
  try{await delay(30000,undefined,{signal:shutdown.signal});}catch{}
}while(!stop);
