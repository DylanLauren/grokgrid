// Durable observations only. These records are not transaction or revenue receipts.
import { constants } from 'node:fs';
import { open, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const LIMIT=128*1024;
const privateOwned=s=>(!process.getuid||s.uid===process.getuid())&&(s.mode&0o077)===0;
const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value);
export async function assertPrivateRoot(root) {
  if(!isAbsolute(root)||resolve(root)!==root)throw Error('private-path-required');
  await mkdir(root,{recursive:true,mode:0o700});
  let path=root;
  while(true){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(path===root&&!privateOwned(s)))throw Error('private-directory-required');const parent=dirname(path);if(parent===path)break;path=parent;}
}
function validFile(s) {if(!s.isFile()||s.nlink!==1||!privateOwned(s))throw Error('private-file-required');}
export async function readPrivateText(path,maxBytes=1024*1024) {
  await assertPrivateRoot(dirname(path));
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const s=await f.stat();validFile(s);if(s.size>maxBytes)throw Error('input-too-large');return await f.readFile('utf8');}finally{await f.close();}
}
async function syncDirectory(root){const f=await open(root,'r');try{await f.sync();}finally{await f.close();}}
export async function savePrivateJSON(path,value) {
  await assertPrivateRoot(dirname(path));
  try{validFile(await lstat(path));}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=path+'.'+randomUUID()+'.tmp';let f;
  try{f=await open(tmp,'wx',0o600);await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();await f.close();f=null;await rename(tmp,path);await syncDirectory(dirname(path));}
  finally{if(f)await f.close();await unlink(tmp).catch(()=>{});}
}
function validateSnapshot(value,pins) {
  if(!value||!Number.isFinite(Date.parse(value.observedAt))||value.house?.wallet!==pins.houseWallet||value.burn?.wallet!==pins.burnWallet||!integer(value.house?.balanceLamports)||!integer(value.burn?.balanceLamports)||!Number.isSafeInteger(value.balanceSlot)||value.balanceSlot<1||value.balanceCommitment!=='finalized')throw Error('observation-identity-invalid');
}
export function assertSnapshotProgress(previous,current) {
  if(!previous)return;
  if(current.balanceSlot<previous.balanceSlot)throw Error('balance-slot-regressed');
  if(current.balanceSlot===previous.balanceSlot&&(current.house.balanceLamports!==previous.house.balanceLamports||current.burn.balanceLamports!==previous.burn.balanceLamports))throw Error('balance-slot-conflict');
}
function validateRecord(record,pins) {
  const {hash,...body}=record;
  if(hash!==checksum(body)||record.version!==1||!Number.isSafeInteger(record.sequence)||record.sequence<1||record.houseWallet!==pins.houseWallet||record.burnWallet!==pins.burnWallet||record.observation?.executionEnabled!==false||record.observation?.signingEnabled!==false)throw Error('observation-journal-invalid');
  if(record.lastSuccessful){
    // Early v1 rows kept the finalized slot on the full observation only.
    // Recover that evidence in memory, without rewriting the immutable journal.
    if(record.lastSuccessful.balanceSlot===undefined&&record.observation.status==='observing'&&record.lastSuccessful.observedAt===record.observation.observedAt&&record.lastSuccessful.house.balanceLamports===record.observation.house.balanceLamports&&record.lastSuccessful.burn.balanceLamports===record.observation.burn.balanceLamports){
      record={...record,lastSuccessful:{...record.lastSuccessful,balanceSlot:record.observation.balanceSlot,balanceCommitment:record.observation.balanceCommitment}};
    }
    validateSnapshot(record.lastSuccessful,pins);
  }
  if(!['observing','unavailable'].includes(record.observation.status)||!Number.isFinite(Date.parse(record.observation.observedAt)))throw Error('observation-journal-invalid');
  if(record.observation.status==='observing')validateSnapshot(record.observation,pins);
  return record;
}
async function readTail(path,pins) {
  let f;try{f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  try{
    const s=await f.stat();validFile(s);if(!s.size)return null;
    const start=Math.max(0,s.size-LIMIT*3),buf=Buffer.alloc(s.size-start);let offset=0;while(offset<buf.length){const {bytesRead}=await f.read(buf,offset,buf.length-offset,start+offset);if(!bytesRead)throw Error('observation-journal-incomplete');offset+=bytesRead;}
    if(buf[buf.length-1]!==10)throw Error('observation-journal-incomplete');
    const text=buf.toString('utf8'),lines=text.slice(start?text.indexOf('\n')+1:0,-1).split('\n');
    const last=validateRecord(JSON.parse(lines.at(-1)),pins);
    if(lines.length>1){const previous=validateRecord(JSON.parse(lines.at(-2)),pins);if(last.previousHash!==previous.hash||last.sequence!==previous.sequence+1)throw Error('observation-chain-invalid');}
    else if(start===0&&(last.sequence!==1||last.previousHash!==null))throw Error('observation-chain-invalid');
    return last;
  }finally{await f.close();}
}
function locked(){const error=Error('observer-locked');error.code='OBSERVER_LOCKED';return error;}
async function recoverDeadLock(path) {
  let guard;try{guard=await open(path+'.recovery','wx',0o600);}catch(e){if(e.code==='EEXIST')throw locked();throw e;}
  try{
    let before;try{before=await lstat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}validFile(before);
    const pid=Number((await readPrivateText(path,64)).trim());if(!Number.isSafeInteger(pid)||pid<2)throw locked();
    try{process.kill(pid,0);throw locked();}catch(e){if(e.code!=='ESRCH')throw locked();}
    const after=await lstat(path);if(before.dev!==after.dev||before.ino!==after.ino)throw locked();await unlink(path);
  }finally{await guard.close();await unlink(path+'.recovery');}
}
export async function withObservationJournal(root,pins,fn) {
  if(!pins||![pins.houseWallet,pins.burnWallet].every(x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x))||pins.houseWallet===pins.burnWallet)throw Error('observation-wallets-invalid');
  await assertPrivateRoot(root);
  const lockPath=join(root,'observer-journal.lock'),path=join(root,'observer-observations.jsonl');
  let lock;try{lock=await open(lockPath,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;await recoverDeadLock(lockPath);try{lock=await open(lockPath,'wx',0o600);}catch{throw locked();}}
  const own=await lock.stat();await lock.writeFile(String(process.pid));await lock.sync();await lock.close();
  try{
    let previous=await readTail(path,pins);
    return await fn({get lastSuccessful(){return previous?.lastSuccessful?structuredClone(previous.lastSuccessful):null;},get sequence(){return previous?.sequence??0;},async append(observation){
      if(observation.status==='observing'){validateSnapshot(observation,pins);assertSnapshotProgress(previous?.lastSuccessful,observation);}
      const lastSuccessful=observation.status==='observing'?{observedAt:observation.observedAt,balanceSlot:observation.balanceSlot,balanceCommitment:'finalized',house:{...observation.house},burn:{wallet:observation.burn.wallet,balanceLamports:observation.burn.balanceLamports},officialMint:observation.officialMint??null,mintVerified:observation.mintVerified===true}:previous?.lastSuccessful??null;
      const body={version:1,sequence:(previous?.sequence??0)+1,...pins,previousHash:previous?.hash??null,observation,lastSuccessful};
      const record={...body,hash:checksum(body)};validateRecord(record,pins);const line=JSON.stringify(record)+'\n';if(Buffer.byteLength(line)>LIMIT)throw Error('observation-too-large');
      const f=await open(path,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
      try{validFile(await f.stat());await f.writeFile(line);await f.sync();}finally{await f.close();}
      await syncDirectory(root);previous=record;return record.sequence;
    }});
  }finally{const current=await lstat(lockPath).catch(()=>null);if(current?.dev===own.dev&&current?.ino===own.ino)await unlink(lockPath);}
}
