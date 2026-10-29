import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchCursor, validateLaunchEvents, reconcileLaunchCheckpoint, LAUNCH_COVERAGE } from '../scripts/runtime-launch-events.mjs'
import { withObservationJournal } from '../scripts/runtime-observation-store.mjs'
const pins={houseWallet:'11111111111111111111111111111111',burnWallet:'22222222222222222222222222222222'}
const now=1700000000000
const row={cursor:'1',id:'agent-one',mint:'33333333333333333333333333333333',wallet:'44444444444444444444444444444444',ts:now-10}
const batch=(events=[row],head=String(events.length))=>({version:1,events,nextCursor:events.at(-1)?.cursor??'0',headCursor:head,hasMore:head!==(events.at(-1)?.cursor??'0'),coverage:LAUNCH_COVERAGE,executionEnabled:false})
const observation=(state='durable',events=batch())=>({observedAt:new Date(now).toISOString(),status:'observing',signingEnabled:false,executionEnabled:false,balanceSlot:1,balanceCommitment:'finalized',house:{wallet:pins.houseWallet,balanceLamports:'0'},burn:{wallet:pins.burnWallet,balanceLamports:'0'},launchEvents:{state,afterCursor:'0',batch:events}})
async function fixture(fn:(root:string)=>Promise<void>){const root=await realpath(await mkdtemp(join(tmpdir(),'launch-intake-')));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}

test('ordered batches retain all50 identities and distinguish backlog from completeness',()=>{
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const events=Array.from({length:50},(_,i)=>({...row,cursor:String(i+1),id:`agent-${i}`,mint:'3'.repeat(31)+alphabet[i],wallet:'4'.repeat(31)+alphabet[i]}))
  const result=validateLaunchEvents(batch(events,'75'),'0',now)
  assert.equal(result.events.length,50);assert.equal(result.nextCursor,'50');assert.equal(result.hasMore,true)
  assert.equal(result.executionEnabled,false);assert.equal(result.coverage,LAUNCH_COVERAGE)
  assert.equal(validateLaunchEvents({...batch([]),nextCursor:'75',headCursor:'75',hasMore:false},'75',now).events.length,0)
})
test('server cursor gaps are valid without dropping identities and small clock skew is tolerated',()=>{
  const events=[{...row,cursor:'102',ts:now+1000},{...row,cursor:'109',id:'agent-two',mint:'5'.repeat(32),wallet:'6'.repeat(32)}]
  const result=validateLaunchEvents({...batch(events,'109'),hasMore:false},'99',now)
  assert.equal(result.nextCursor,'109');assert.equal(result.events.length,2)
  assert.throws(()=>validateLaunchEvents({...batch([...events].reverse(),'109'),nextCursor:'102',hasMore:true},'99',now))
})
test('invalid cursors, skipped/repeated identities, future events and inconsistent head fail closed',()=>{
  for(const cursor of ['01','-1','1.0','9007199254740992',1,null])assert.throws(()=>launchCursor(cursor))
  const bad=[{...batch(),nextCursor:'2'},{...batch(),headCursor:'0'},{...batch(),hasMore:true},{...batch(),executionEnabled:true},{...batch(),coverage:'all-history'},batch([{...row,cursor:'0'}]),batch([{...row,wallet:'bad'}]),batch([{...row,ts:now+300_001}]),batch([row,{...row,cursor:'2'}]),{...batch([]),headCursor:'2',hasMore:true}]
  for(const value of bad)assert.throws(()=>validateLaunchEvents(value,'0',now))
})
test('crash before append replays; crash after fsync recovers checkpoint from journal without skipping',async()=>fixture(async root=>{
  const initial=reconcileLaunchCheckpoint(null,pins,'0',0)
  await assert.rejects(withObservationJournal(root,pins,async()=>{throw Error('before-append')}))
  await assert.rejects(withObservationJournal(root,pins,async journal=>{
    assert.equal(journal.launchCursor,'0');await journal.append(observation());throw Error('after-fsync-before-checkpoint')
  }))
  await withObservationJournal(root,pins,async journal=>{
    assert.equal(journal.launchCursor,'1')
    const recovered=reconcileLaunchCheckpoint(initial,pins,journal.launchCursor,journal.sequence)
    assert.equal(recovered.cursor,'1');assert.equal(recovered.observationSequence,1)
    await assert.rejects(journal.append(observation()),/cursor-conflict/)
    await journal.append({observedAt:new Date(now).toISOString(),status:'unavailable',signingEnabled:false,executionEnabled:false})
  })
  await withObservationJournal(root,pins,async journal=>assert.equal(journal.launchCursor,'1'))
  const lines=(await readFile(join(root,'observer-observations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(lines[0].observation.launchEvents.batch.events,[row]);assert.equal(lines[1].launchCursor,'1')
}))
test('rule persistence failure journals whole batch but safely replays without advancing',async()=>fixture(async root=>{
  await withObservationJournal(root,pins,async journal=>{
    await journal.append(observation('durable-pending-rules'));assert.equal(journal.launchCursor,'0')
  })
  await withObservationJournal(root,pins,async journal=>{
    assert.equal(journal.launchCursor,'0');await journal.append(observation());assert.equal(journal.launchCursor,'1')
  })
  await withObservationJournal(root,pins,async journal=>assert.equal(journal.launchCursor,'1'))
}))
test('malformed batch cannot advance journal and ahead or foreign checkpoint cannot skip records',async()=>fixture(async root=>{
  await withObservationJournal(root,pins,async journal=>{
    await assert.rejects(journal.append(observation('durable',{...batch(),nextCursor:'2'})))
    assert.equal(journal.sequence,0);assert.equal(journal.launchCursor,'0')
  })
  const cp=reconcileLaunchCheckpoint(null,pins,'0',0)
  for(const invalid of [{...cp,cursor:'1'},{...cp,observationSequence:1},{...cp,houseWallet:pins.burnWallet},{...cp,executionEnabled:true}])assert.throws(()=>reconcileLaunchCheckpoint(invalid,pins,'0',0))
}))
