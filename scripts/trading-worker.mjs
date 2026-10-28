#!/usr/bin/env node
// Observation/planning worker. Optional read-only receipt RPC; no signing or broadcast.
import { readFile, writeFile, rename, mkdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { validateTradingPolicy, expireIntents, planIntent, reconcileHeldIntent } from './trading-policy.mjs';
import { createFinalizedReceiptVerifier } from './trading-reconcile.mjs';
import { withTradingStore } from './trading-store.mjs';
const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const args = process.argv.slice(2);
const proposalAt = args.indexOf('--proposal');
if (args.some((x,i) => x !== '--once' && x !== '--reconcile' && x !== '--proposal' && !(proposalAt >= 0 && i === proposalAt + 1)) || (proposalAt >= 0 && (!args[proposalAt+1] || args[proposalAt+1].startsWith('--')))) { console.error('Usage: trading-worker.mjs [--once] [--reconcile] [--proposal /path/to/proposal.json]'); process.exit(1); }
let stop = false;
process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function saveStatus(status) {
  const path = join(root,'trading-status.json'); await writeFile(path+'.tmp', JSON.stringify(status,null,2)+'\n',{mode:0o600}); await rename(path+'.tmp',path);
}
async function tick() {
  const now = Date.now(), policy = validateTradingPolicy(await json(join(root,'trading-config.json')));
  let observation; try { observation = await json(join(root,'observer-status.json')); } catch { observation = null; }
  const age = observation ? now - Date.parse(observation.observedAt) : NaN;
  const observerFresh = observation?.status === 'observing' && observation.mode === 'observe-only' && observation.house?.wallet === policy.wallet && observation.executionEnabled === false && observation.signingEnabled === false && Number.isFinite(age) && age >= 0 && age <= 90000;
  const state = await withTradingStore(join(root,'trading'),policy,async s => {
    s = expireIntents(s,now);
    if (args.includes('--reconcile') && s.intents.some(i=>i.state==='held-ambiguous')) {
      const connectionFile = join(root,'observer-config.json'), info = await lstat(connectionFile);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw Error('Receipt provider configuration must be private');
      const connection = await json(connectionFile);
      if (connection.houseWallet !== policy.wallet) throw Error('Receipt provider wallet configuration mismatch');
      const verify = createFinalizedReceiptVerifier(connection.rpcUrl);
      for (const intent of s.intents.filter(i=>i.state==='held-ambiguous')) s = await reconcileHeldIntent(s,policy,intent.id,verify);
    }
    if (proposalAt >= 0) s = planIntent(s,policy,await json(resolve(args[proposalAt+1])),observation,await json(join(root,'trading-risk.json')),now);
    return s;
  });
  const status = { observedAt:new Date(now).toISOString(), mode:'observe-only', executionEnabled:false, signingEnabled:false,
    status:observerFresh?'observing-execution-disabled':'observer-unavailable', agentId:policy.agentId, wallet:policy.wallet,
    observerFresh, observerAgeMs:Number.isFinite(age)?age:null, journalRevision:state.revision,
    intents:state.intents.map(i=>({id:i.id,mint:i.mint,state:i.state})), pendingLaunchesObserved:observerFresh && Array.isArray(observation.pendingLaunches)?observation.pendingLaunches.length:null,
    strategy:'unvalidated-no-orders', automaticLaunchesEnabled:false, reconciliationEnabled:args.includes('--reconcile') };
  await saveStatus(status); console.log(JSON.stringify({status:status.status,revision:state.revision,intents:state.intents.length,executionEnabled:false}));
}
await mkdir(root,{recursive:true,mode:0o700});
do {
  try { await tick(); } catch {
    // Do not print parsed input or errors that could contain local credentials.
    await saveStatus({observedAt:new Date().toISOString(),status:'unavailable',executionEnabled:false,signingEnabled:false}).catch(()=>{});
    console.error('Trading observer unavailable; no execution attempted. Inspect private configuration and journal.');
    if (args.includes('--once') || proposalAt >= 0) process.exitCode=1;
  }
  if (args.includes('--once') || proposalAt >= 0 || stop) break;
  await new Promise(r=>setTimeout(r,30000));
} while (!stop);
