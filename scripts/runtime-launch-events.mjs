// Observation-only outbox validation. Cursors never acknowledge execution.
export const LAUNCH_COVERAGE='confirmed-launches-after-outbox-deployment';
export function launchCursor(value) {
  if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('launch-cursor-invalid');
  return Number(value);
}
export function validateLaunchEvents(value,after,now=Date.now(),limit=50) {
  const start=launchCursor(after);
  if(!value||value.version!==1||value.coverage!==LAUNCH_COVERAGE||value.executionEnabled!==false||!Array.isArray(value.events)||value.events.length>limit||!Number.isSafeInteger(now)||now<1)throw Error('launch-events-invalid');
  const next=launchCursor(value.nextCursor),head=launchCursor(value.headCursor);
  if(next<start||head<next||typeof value.hasMore!=='boolean'||value.hasMore!==(next<head))throw Error('launch-events-progress-invalid');
  const addresses=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const ids=new Set(),mints=new Set(),wallets=new Set();
  let previous=start;
  const events=value.events.map(row=>{
    if(!row||launchCursor(row.cursor)<=previous||launchCursor(row.cursor)>head||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(row.id)||row.id==='house'||typeof row.mint!=='string'||!addresses.test(row.mint)||typeof row.wallet!=='string'||!addresses.test(row.wallet)||!Number.isSafeInteger(row.ts)||row.ts<1||row.ts>now+300_000||ids.has(row.id)||mints.has(row.mint)||wallets.has(row.wallet))throw Error('launch-event-identity-invalid');
    previous=launchCursor(row.cursor);
    ids.add(row.id);mints.add(row.mint);wallets.add(row.wallet);
    return {cursor:row.cursor,id:row.id,mint:row.mint,wallet:row.wallet,ts:row.ts};
  });
  if(next!==previous||(!events.length&&head!==start))throw Error('launch-events-gap');
  return {version:1,events,nextCursor:String(next),headCursor:String(head),hasMore:value.hasMore,coverage:LAUNCH_COVERAGE,executionEnabled:false};
}
export function reconcileLaunchCheckpoint(checkpoint,pins,journalCursor,journalSequence) {
  const cursor=launchCursor(journalCursor);
  if(!Number.isSafeInteger(journalSequence)||journalSequence<0)throw Error('launch-checkpoint-invalid');
  if(checkpoint){
    if(checkpoint.version!==1||checkpoint.houseWallet!==pins.houseWallet||checkpoint.burnWallet!==pins.burnWallet||checkpoint.coverage!==LAUNCH_COVERAGE||checkpoint.executionEnabled!==false||!Number.isSafeInteger(checkpoint.observationSequence)||checkpoint.observationSequence<0||checkpoint.observationSequence>journalSequence||launchCursor(checkpoint.cursor)>cursor)throw Error('launch-checkpoint-conflict');
    if(checkpoint.observationSequence===journalSequence&&checkpoint.cursor!==journalCursor)throw Error('launch-checkpoint-conflict');
  }
  return {version:1,...pins,cursor:journalCursor,observationSequence:journalSequence,coverage:LAUNCH_COVERAGE,executionEnabled:false};
}
