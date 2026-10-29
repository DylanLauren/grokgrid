import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, appendFile, chmod, symlink, link, rm, realpath, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { withObservationJournal, savePrivateJSON, readPrivateText } from '../scripts/runtime-observation-store.mjs'
import { fundState } from '../scripts/runtime-policy.mjs'
const pins={houseWallet:'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT',burnWallet:'E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq'}
const observation=(balance='100',slot=100)=>({balanceSlot:slot,balanceCommitment:'finalized',observedAt:new Date().toISOString(),status:'observing',signingEnabled:false,executionEnabled:false,house:{wallet:pins.houseWallet,balanceLamports:'0'},burn:{wallet:pins.burnWallet,balanceLamports:balance},officialMint:null,mintVerified:false})
const unavailable=()=>({observedAt:new Date().toISOString(),status:'unavailable',signingEnabled:false,executionEnabled:false})
async function fixture(fn:(root:string)=>Promise<void>){const root=await mkdtemp(join(await realpath(tmpdir()),'runtime-journal-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}

test('restart and unavailable observations retain last successful balance without inventing revenue',async()=>fixture(async root=>{
  await withObservationJournal(root,pins,async j=>{assert.equal(j.lastSuccessful,null);await j.append(observation());})
  await withObservationJournal(root,pins,async j=>{assert.equal(j.sequence,1);await j.append(unavailable());})
  await withObservationJournal(root,pins,async j=>{
    assert.equal(j.sequence,2);assert.equal(j.lastSuccessful.burn.balanceLamports,'100')
    const state=fundState({balanceLamports:'250',previousLamports:j.lastSuccessful.burn.balanceLamports,mint:'',mintVerified:false,reserveLamports:'10',thresholdLamports:'20'})
    assert.equal(state.balanceChangeLamports,'150');assert.equal(state.state,'awaiting-official-mint');assert.equal(state.revenueVerified,false);assert.equal(state.executionEnabled,false)
    await j.append(observation('250',101))
  })
  const rows=(await readFile(join(root,'observer-observations.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x))
  assert.equal(rows.length,3);assert.equal(rows[2].previousHash,rows[1].hash)
}))

test('durable append survives missing latest-status publication and rejects wallet drift',async()=>fixture(async root=>{
  await assert.rejects(withObservationJournal(root,pins,async j=>{await j.append(observation());throw Error('status-publish-crash')}))
  await withObservationJournal(root,pins,async j=>assert.equal(j.lastSuccessful.burn.balanceLamports,'100'))
  await assert.rejects(withObservationJournal(root,{houseWallet:pins.burnWallet,burnWallet:pins.houseWallet},async()=>{}),/journal/)
}))

test('incomplete or corrupt tail is preserved and fails closed rather than truncating evidence',async()=>fixture(async root=>{
  await withObservationJournal(root,pins,async j=>j.append(observation()))
  const path=join(root,'observer-observations.jsonl');await appendFile(path,'{"partial":')
  const before=await readFile(path,'utf8');await assert.rejects(withObservationJournal(root,pins,async()=>{}),/incomplete/);assert.equal(await readFile(path,'utf8'),before)
  await writeFile(path,before.slice(0,before.lastIndexOf('\n')+1).replace('"balanceLamports":"100"','"balanceLamports":"999"'))
  await assert.rejects(withObservationJournal(root,pins,async()=>{}),/journal/)
}))

test('single-writer lock prevents competing observations and releases after failure',async()=>fixture(async root=>{
  await withObservationJournal(root,pins,async j=>{
    await assert.rejects(withObservationJournal(root,pins,async()=>{}),(e:any)=>e.code==='OBSERVER_LOCKED')
    await j.append(unavailable())
  })
  await withObservationJournal(root,pins,async j=>assert.equal(j.sequence,1))
}))

test('private reads and atomic status writes reject public, linked, and symlink inputs',async()=>fixture(async root=>{
  const path=join(root,'status.json');await savePrivateJSON(path,{status:'observing'});assert.deepEqual(JSON.parse(await readPrivateText(path)),{status:'observing'})
  assert.deepEqual((await readdir(root)).filter(x=>x.endsWith('.tmp')),[])
  await chmod(path,0o644);await assert.rejects(readPrivateText(path),/private-file/);await assert.rejects(savePrivateJSON(path,{}),/private-file/)
  await chmod(path,0o600);const alias=join(root,'alias');await symlink(path,alias);await assert.rejects(savePrivateJSON(alias,{}),/private-file/)
  await assert.rejects(readPrivateText(alias))
  const hard=join(root,'hard');await link(path,hard);await assert.rejects(readPrivateText(hard),/private-file/)
}))


test('dead writer lock is recovered, while regressed or conflicting finalized slots cannot replace evidence',async()=>fixture(async root=>{
  const child=spawnSync(process.execPath,['-e','process.exit(0)'])
  assert.equal(child.status,0)
  await writeFile(join(root,'observer-journal.lock'),String(child.pid),{mode:0o600})
  await withObservationJournal(root,pins,async j=>j.append(observation()))
  await withObservationJournal(root,pins,async j=>{
    await assert.rejects(j.append(observation('90',99)),/regressed/)
    await assert.rejects(j.append(observation('90',100)),/conflict/)
    assert.equal(j.lastSuccessful.burn.balanceLamports,'100')
    assert.equal(j.sequence,1)
  })
}))


test('earlier compact v1 snapshots recover their slot from the checked full observation without rewriting history',async()=>fixture(async root=>{
  await withObservationJournal(root,pins,async j=>j.append(observation()))
  const path=join(root,'observer-observations.jsonl'),row=JSON.parse(await readFile(path,'utf8'))
  delete row.lastSuccessful.balanceSlot;delete row.lastSuccessful.balanceCommitment
  const {hash:_ignored,...body}=row
  row.hash=createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const original=JSON.stringify(row)+'\n';await writeFile(path,original)
  await withObservationJournal(root,pins,async j=>assert.equal(j.lastSuccessful.balanceSlot,100))
  assert.equal(await readFile(path,'utf8'),original)
}))
