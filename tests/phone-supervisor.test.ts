import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, lstat, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { unlinkSync, writeFileSync } from 'node:fs'
// @ts-expect-error Node runtime
import { decidePhoneRestart, planPhoneLockRecovery } from '../scripts/phone-supervisor-core.mjs'
// @ts-expect-error Node runtime
import { recoverPhoneLock, runPhoneSupervisor } from '../scripts/phone-supervisor.mjs'
const uid=process.getuid!(), meta={isFile:true,isSymbolicLink:false,uid,mode:0o100600,nlink:1,dev:1,ino:2}
test('restart decision is bounded and never retries auth rejection, source mismatch or explicit stop',()=>{
 assert.deepEqual(decidePhoneRestart({exitCode:1,restarts:0}),{action:'restart',reason:'publisher-unavailable',delayMs:60000})
 assert.equal(decidePhoneRestart({exitCode:1,restarts:4}).delayMs,300000)
 assert.equal(decidePhoneRestart({exitCode:1,restarts:5}).action,'stop')
 for(const reason of ['credential-rejected','request-rejected','window-identity-mismatch','browser-url-mismatch','phone-window-geometry-invalid','browser-viewport-invalid'])assert.equal(decidePhoneRestart({exitCode:1,status:{reason}}).action,'stop')
 assert.equal(decidePhoneRestart({exitCode:1,status:{reason:'screen-credential-invalid-or-expiring'}}).action,'wait-renewal')
 assert.equal(decidePhoneRestart({exitCode:null,signal:'SIGTERM'}).action,'stop')
 assert.equal(decidePhoneRestart({exitCode:0}).action,'stop')
})
test('only a private regular owned lock and positively dead PID may be recovered',()=>{
 const input={contents:'123',metadata:meta,expectedUid:uid,processState:'dead'}
 assert.equal(planPhoneLockRecovery(input).action,'remove-lock')
 for(const processState of ['alive','unknown','EPERM'])assert.equal(planPhoneLockRecovery({...input,processState}).action,'hold')
 for(const metadata of [{...meta,uid:uid+1},{...meta,mode:0o100644},{...meta,isSymbolicLink:true},{...meta,nlink:2},{...meta,isFile:false}])assert.equal(planPhoneLockRecovery({...input,metadata}).action,'hold')
 for(const contents of ['','0','-1','123 garbage','{"pid":123}'])assert.equal(planPhoneLockRecovery({...input,contents}).action,'hold')
})
test('actual recovery preserves live/unknown/reused PID locks and refuses symlinks and competing recovery',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-test-'))),lock=join(root,'publisher.lock')
 try{
  await writeFile(lock,'123',{mode:0o600})
  await assert.rejects(recoverPhoneLock(lock,()=> 'alive'));assert.equal(await readFile(lock,'utf8'),'123')
  await assert.rejects(recoverPhoneLock(lock,()=> 'unknown'));assert.equal(await readFile(lock,'utf8'),'123')
  let checks=0;await assert.rejects(recoverPhoneLock(lock,()=> ++checks===1?'dead':'alive'));assert.equal(await readFile(lock,'utf8'),'123')
  await writeFile(lock+'.recovery','999',{mode:0o600});await assert.rejects(recoverPhoneLock(lock,()=> 'dead'));await rm(lock+'.recovery')
  assert.equal(await recoverPhoneLock(lock,()=> 'dead'),'recovered');await assert.rejects(lstat(lock))
  await writeFile(join(root,'target'),'123',{mode:0o600});await symlink(join(root,'target'),lock);await assert.rejects(recoverPhoneLock(lock,()=> 'dead'));assert.equal(await readFile(join(root,'target'),'utf8'),'123')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('changed lock inode cannot be unlinked during recovery',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-race-'))),lock=join(root,'publisher.lock')
 try{
  await writeFile(lock,'123',{mode:0o600});let checks=0
  await assert.rejects(recoverPhoneLock(lock,()=>{ if(++checks===1){unlinkSync(lock);writeFileSync(lock,'456',{mode:0o600})}return 'dead'}))
  assert.equal(await readFile(lock,'utf8'),'456')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('supervisor stops after publisher auth rejection without reading token contents or changing source config',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-cli-'))),configPath=join(root,'config.json'),statusPath=join(root,'publisher-status.json'),tokenPath=join(root,'token')
 const config={source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:statusPath}
 const original=JSON.stringify(config)
 try{
  await writeFile(configPath,original,{mode:0o600});await writeFile(tokenPath,'THIS IS NOT A TOKEN; SUPERVISOR MUST NOT PARSE IT',{mode:0o600})
  let launches=0
  await runPhoneSupervisor(configPath,{spawnPublisher:()=>{
   launches++;const child=new EventEmitter() as any;child.pid=9876;child.kill=()=>true
   setTimeout(async()=>{await writeFile(statusPath,JSON.stringify({state:'stopped-error',reason:'credential-rejected',observedAt:new Date().toISOString()}),{mode:0o600});child.emit('exit',1,null)},30)
   return child
  }})
  assert.equal(launches,1);assert.equal(await readFile(configPath,'utf8'),original)
  const result=JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8'));assert.equal(result.state,'stopped-needs-operator');assert.equal(result.reason,'credential-rejected');assert.equal(result.childPid,null)
  await assert.rejects(lstat(join(root,'local-phone-supervisor-status.json.lock')))
 }finally{await rm(root,{recursive:true,force:true})}
})

test('operator stop terminates the child and never respawns it',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-stop-'))),configPath=join(root,'config.json'),tokenPath=join(root,'token')
 try{
  await writeFile(configPath,JSON.stringify({source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:join(root,'publisher-status.json')}),{mode:0o600});await writeFile(tokenPath,'opaque',{mode:0o600})
  let launches=0,kills=0
  await runPhoneSupervisor(configPath,{spawnPublisher:()=>{launches++;const child=new EventEmitter() as any;child.pid=9876;child.kill=()=>{kills++;setImmediate(()=>child.emit('exit',null,'SIGTERM'));return true};setTimeout(()=>process.emit('SIGTERM'),30);return child}})
  assert.equal(launches,1);assert.ok(kills>0)
  const result=JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8'));assert.equal(result.state,'stopped');assert.equal(result.reason,'operator-stop')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('operator pause and JPEG source rejection terminate the optional video sidecar',async()=>{
 for(const reason of ['operator','window-identity-mismatch']){
  const root=await realpath(await mkdtemp(join(tmpdir(),'phone-video-supervisor-'))),configPath=join(root,'config.json'),tokenPath=join(root,'token'),statusPath=join(root,'publisher-status.json'),videoPath=join(root,'video.json')
  try{
   await writeFile(configPath,JSON.stringify({source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:statusPath,videoConfigFile:videoPath}),{mode:0o600})
   await writeFile(tokenPath,'opaque',{mode:0o600});await writeFile(videoPath,'{}',{mode:0o600})
   let videoStarts=0,videoStops=0
   const fake=()=>{const child=new EventEmitter() as any;child.pid=9876;child.kill=()=>{setImmediate(()=>child.emit('exit',null,'SIGTERM'));return true};return child}
   await runPhoneSupervisor(configPath,{
    spawnVideo:()=>{videoStarts++;const child=fake();child.kill=()=>{videoStops++;setImmediate(()=>child.emit('exit',null,'SIGTERM'));return true};return child},
    spawnPublisher:()=>{const child=fake();setTimeout(async()=>{
     if(reason==='operator')process.emit('SIGTERM')
     else{await writeFile(statusPath,JSON.stringify({state:'stopped-error',reason,observedAt:new Date().toISOString()}),{mode:0o600});child.emit('exit',1,null)}
    },30);return child},
   })
   assert.equal(videoStarts,1);assert.ok(videoStops>=1)
   await assert.rejects(lstat(join(root,'local-phone-supervisor-status.json.lock')))
  }finally{await rm(root,{recursive:true,force:true})}
 }
})
test('expiry retry requires changed capability metadata and never repins the source',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-renew-'))),configPath=join(root,'config.json'),tokenPath=join(root,'token'),statusPath=join(root,'publisher-status.json')
 try{
  const input=JSON.stringify({source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:statusPath})
  await writeFile(configPath,input,{mode:0o600});await writeFile(tokenPath,'opaque-old',{mode:0o600});let launches=0
  await runPhoneSupervisor(configPath,{spawnPublisher:()=>{
   launches++;const number=launches,child=new EventEmitter() as any;child.pid=9876;child.kill=()=>true
   setTimeout(async()=>{
    if(number===1){await writeFile(statusPath,JSON.stringify({state:'stopped-error',reason:'screen-credential-invalid-or-expiring',observedAt:new Date().toISOString()}),{mode:0o600});await rm(tokenPath);await writeFile(tokenPath,'opaque-renewed',{mode:0o600});child.emit('exit',1,null)}
    else child.emit('exit',0,null)
   },30);return child
  }})
  assert.equal(launches,2);assert.equal(await readFile(configPath,'utf8'),input)
  const result=JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8'));assert.equal(result.reason,'publisher-completed')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('an unchanged expired capability waits without restarting and can be stopped',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-expired-'))),configPath=join(root,'config.json'),tokenPath=join(root,'token'),statusPath=join(root,'publisher-status.json')
 try{
  await writeFile(configPath,JSON.stringify({source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:statusPath}),{mode:0o600});await writeFile(tokenPath,'opaque',{mode:0o600});let launches=0
  await runPhoneSupervisor(configPath,{spawnPublisher:()=>{
   launches++;const child=new EventEmitter() as any;child.pid=9876;child.kill=()=>true
   setTimeout(async()=>{await writeFile(statusPath,JSON.stringify({state:'stopped-error',reason:'screen-credential-invalid-or-expiring',observedAt:new Date().toISOString()}),{mode:0o600});child.emit('exit',1,null);setTimeout(()=>process.emit('SIGTERM'),50)},30)
   return child
  }})
  assert.equal(launches,1);assert.equal(JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8')).state,'stopped')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('losing the native parent stops and awaits only its publisher, without respawn',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-parent-'))),configPath=join(root,'config.json'),tokenPath=join(root,'token')
 try{
  await writeFile(configPath,JSON.stringify({source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:join(root,'publisher-status.json')}),{mode:0o600});await writeFile(tokenPath,'opaque',{mode:0o600})
  let launches=0,parentPid=1234,exited=false;const signals:string[]=[]
  await runPhoneSupervisor(configPath,{parentPid:1234,getParentPid:()=>parentPid,spawnPublisher:()=>{
   launches++;const child=new EventEmitter() as any;child.pid=9876;child.kill=(signal:string)=>{signals.push(signal);setTimeout(()=>{exited=true;child.emit('exit',null,'SIGTERM')},20);return true};setTimeout(()=>{parentPid=1},30);return child
  }})
  assert.equal(launches,1);assert.ok(exited);assert.ok(signals.length>0);assert.ok(signals.every(x=>x==='SIGTERM'))
  const status=JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8'));assert.equal(status.state,'stopped');assert.equal(status.reason,'parent-exited');assert.equal(status.childPid,null)
  await assert.rejects(lstat(join(root,'local-phone-supervisor-status.json.lock')))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('an already missing parent never starts a publisher',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'phone-supervisor-parent-gone-'))),configPath=join(root,'config.json'),tokenPath=join(root,'token')
 try{
  await writeFile(configPath,JSON.stringify({source:'grok-bot-actual-window',windowId:99,ownerPid:123,bundleId:'com.google.Chrome',title:'Pump',browserUrl:'https://pump.fun/',tokenFile:tokenPath,statusFile:join(root,'publisher-status.json')}),{mode:0o600});await writeFile(tokenPath,'opaque',{mode:0o600})
  let launches=0
  await runPhoneSupervisor(configPath,{parentPid:1234,getParentPid:()=>1,spawnPublisher:()=>{launches++;throw Error('must not spawn')}})
  assert.equal(launches,0);assert.equal(JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8')).reason,'parent-exited')
  await assert.rejects(runPhoneSupervisor(configPath,{parentPid:0}),/invalid-parent-pid/)
  if(process.ppid>1){
   await runPhoneSupervisor(configPath,{getParentPid:()=>1,spawnPublisher:()=>{launches++;throw Error('must not spawn')}})
   assert.equal(launches,0);assert.equal(JSON.parse(await readFile(join(root,'local-phone-supervisor-status.json'),'utf8')).reason,'parent-exited')
  }
 }finally{await rm(root,{recursive:true,force:true})}
})

test('a crash while waiting for the pinned window uses normal bounded restart, not source-mismatch stop', () => {
 assert.equal(decidePhoneRestart({exitCode:null,signal:'SIGKILL',status:{state:'waiting-for-window',reason:'window-temporarily-unavailable'},restarts:0}).action,'restart')
 assert.equal(decidePhoneRestart({exitCode:null,signal:'SIGKILL',status:{state:'waiting-for-window',reason:'window-temporarily-unavailable'},restarts:5}).action,'stop')
 assert.equal(decidePhoneRestart({exitCode:1,status:{reason:'browser-url-mismatch'},restarts:0}).action,'stop')
})
