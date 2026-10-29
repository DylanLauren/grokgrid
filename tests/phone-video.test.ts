import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countPhoneViewers, videoDemand, ffmpegPhoneArgs, readPrivateVideoFile, validateWhipUrl } from '../scripts/phone-video-core.mjs'
import { createWhipProxy } from '../scripts/phone-video-whip.mjs'
const viewer = { identity:'viewer-00000000-0000-4000-8000-000000000001', kind:0, permission:{canSubscribe:true,canPublish:false,canPublishData:false} }
test('only authorized subscribe-only standard viewers trigger demand; publishers and agents do not', () => {
  assert.equal(countPhoneViewers([viewer,{...viewer,kind:1},{...viewer,identity:'house-publisher'},{...viewer,permission:{...viewer.permission,canPublish:true}},{identity:viewer.identity}]),1)
  assert.equal(videoDemand({viewers:1,running:false,lastViewerAt:0,now:10000}), 'start')
  assert.equal(videoDemand({viewers:0,running:true,lastViewerAt:10000,now:14999}), 'keep')
  assert.equal(videoDemand({viewers:0,running:true,lastViewerAt:10000,now:15000}), 'stop-idle')
  assert.equal(videoDemand({viewers:10,running:true,lastViewerAt:10000,now:10001,queryOk:false}), 'stop-unverified')
})
test('encoder accepts only localhost signaling and even dimensions, disables audio, never needs provider URL', () => {
  const args=ffmpegPhoneArgs({width:780,height:1144,fps:15},'http://127.0.0.1:1234/local-session')
  assert.ok(args.includes('-an')); assert.ok(args.includes('whip')); assert.ok(!args.some((a:string)=>a.includes('livekit.cloud')))
  assert.throws(()=>ffmpegPhoneArgs({width:781,height:1144,fps:15},'http://127.0.0.1:1234/local'),/invalid/)
  assert.throws(()=>ffmpegPhoneArgs({width:780,height:1144,fps:15},'https://remote.example/key'),/invalid/)
  assert.throws(()=>validateWhipUrl('https://livekit.cloud.attacker.example/secret'),/invalid/)
})
test('private config reads reject public files and symlink targets', async () => {
  // macOS /var is a symlink; resolve the temporary root for the no-symlink policy.
  const {realpath}=await import('node:fs/promises')
  const dir=await mkdtemp(join(await realpath(tmpdir()),'phone-video-test-'))
  try {
    const path=join(dir,'private'); await writeFile(path,'test-only',{mode:0o600})
    assert.equal(await readPrivateVideoFile(path),'test-only')
    await chmod(path,0o644); await assert.rejects(readPrivateVideoFile(path),/private-file/)
    await chmod(path,0o600); await symlink(path,join(dir,'alias')); await assert.rejects(readPrivateVideoFile(join(dir,'alias')))
  } finally { await rm(dir,{recursive:true,force:true}) }
})
test('WHIP bridge hides upstream locations, forwards SDP and deletes only its mapped session', async () => {
  const calls:Array<{url:string,method:string}>=[]
  const proxy=await createWhipProxy('https://test.livekit.cloud/w/test-only-key', {fetchImpl:async(url:string,init:RequestInit)=>{
    calls.push({url,method:init.method!})
    return init.method==='POST' ? new Response('answer-sdp',{status:201,headers:{location:'/sessions/test-only-key','content-type':'application/sdp',etag:'one'}}) : new Response(null,{status:204})
  }})
  try {
    const response=await fetch(proxy.url,{method:'POST',headers:{'content-type':'application/sdp'},body:'offer-sdp'})
    assert.equal(response.status,201); assert.equal(await response.text(),'answer-sdp')
    const location=response.headers.get('location')!
    assert.ok(location.startsWith('/')); assert.ok(!location.includes('test-only-key'))
    assert.equal((await fetch(new URL(location,proxy.url),{method:'DELETE'})).status,204)
    assert.equal(calls[1].url,'https://test.livekit.cloud/sessions/test-only-key')
    assert.equal((await fetch(new URL('/unknown',proxy.url),{method:'DELETE'})).status,404)
    assert.equal(calls.length,2)
  } finally {await proxy.close()}
})
test('WHIP bridge refuses redirected or foreign-origin resource URLs', async () => {
  for (const status of [201,307]) {
    const proxy=await createWhipProxy('https://test.livekit.cloud/w/test-only-key',{fetchImpl:async()=>new Response('ignored',{status,headers:{location:'https://attacker.example/session'}})})
    try { assert.equal((await fetch(proxy.url,{method:'POST',body:'offer'})).status,502) } finally {await proxy.close()}
  }
})

test('guard failures require fresh source validation and all recovery has a bounded budget', async () => {
  const {videoRestartDecision}=await import('../scripts/phone-video-core.mjs')
  const exits={captureCode:4,captureSignal:null,encoderCode:1,encoderSignal:null}
  assert.deepEqual([0,1,2].map(attempts=>videoRestartDecision({...exits,attempts}).delayMs),[5000,10000,20000])
  assert.equal(videoRestartDecision({...exits,attempts:3}).restart,false)
  assert.equal(videoRestartDecision({...exits,captureCode:3,attempts:0}).revalidateSource,true)
  assert.equal(videoRestartDecision({...exits,captureCode:3,attempts:3}).restart,false)
  assert.equal(videoRestartDecision({...exits,captureCode:77,attempts:0}).restart,false)
  assert.equal(videoRestartDecision({captureCode:null,captureSignal:null,encoderCode:null,encoderSignal:null,attempts:0}).restart,false)
})
test('WHIP PATCH preserves body and If-Match, and close retries a failed upstream DELETE', async () => {
  const calls:Array<{url:string,init:RequestInit}>=[]
  let deletes=0
  const proxy=await createWhipProxy('https://test.livekit.cloud/w/test-only-key',{fetchImpl:async(url:string,init:RequestInit)=>{
    calls.push({url,init})
    if(init.method==='POST')return new Response('answer',{status:201,headers:{location:'/resource?token=test-only-session',etag:'one'}})
    if(init.method==='PATCH')return new Response(null,{status:204,headers:{etag:'two'}})
    return new Response(null,{status:++deletes===1?500:204})
  }})
  const response=await fetch(proxy.url,{method:'POST',body:'offer'})
  const resource=new URL(response.headers.get('location')!,proxy.url)
  await fetch(resource,{method:'PATCH',headers:{'if-match':'one','content-type':'application/trickle-ice-sdpfrag'},body:'candidate'})
  assert.equal(calls[1].url,'https://test.livekit.cloud/resource?token=test-only-session')
  assert.equal((calls[1].init.headers as Record<string,string>)['if-match'],'one')
  assert.equal(Buffer.from(calls[1].init.body as Uint8Array).toString(),'candidate')
  await fetch(resource,{method:'DELETE',headers:{'if-match':'two'}})
  await proxy.close()
  assert.equal(deletes,2)
  assert.equal((calls.at(-1)!.init.headers as Record<string,string>)['if-match'],'two')
})

test('startup cannot remain processes-running indefinitely without frames and successful signaling', async () => {
  const {videoStartupFailure}=await import('../scripts/phone-video-core.mjs')
  assert.equal(videoStartupFailure({elapsedMs:19999,frameBytes:0,signaling:[]}),null)
  assert.equal(videoStartupFailure({elapsedMs:20000,frameBytes:0,signaling:[]}), 'capture-startup-timeout')
  assert.equal(videoStartupFailure({elapsedMs:20000,frameBytes:100,signaling:[{event:'upstream-response',method:'POST',status:307}]}), 'signaling-startup-timeout')
  assert.equal(videoStartupFailure({elapsedMs:20000,frameBytes:100,signaling:[{event:'upstream-response',method:'POST',status:201}]}),null)
})

test('read-only checks and unconfigured sources never invoke geometry preparation', async () => {
  const {preparePhoneVideoSource}=await import('../scripts/phone-video-core.mjs')
  for(const [config,checkOnly] of [[{expectedWindowSize:{width:414,height:896}},true],[{},false]] as const){
    let inspected=0
    const result=await preparePhoneVideoSource(config,{checkOnly,prepare:async()=>assert.fail('must not resize'),inspect:async()=>{inspected++;return {width:780,height:1688}}})
    assert.equal(inspected,1);assert.equal(result.height,1688)
  }
})
test('opted-in preparation must succeed and pass a fresh read-only check before start', async () => {
  const {preparePhoneVideoSource}=await import('../scripts/phone-video-core.mjs')
  const config={expectedWindowSize:{width:414,height:896}},events:string[]=[]
  await preparePhoneVideoSource(config,{checkOnly:false,prepare:async()=>{events.push('verified-binding-and-resize')},inspect:async()=>{events.push('fresh-inspection');return {height:1688}}})
  assert.deepEqual(events,['verified-binding-and-resize','fresh-inspection'])
  await assert.rejects(preparePhoneVideoSource(config,{checkOnly:false,prepare:async()=>{throw Error('binding-mismatch')},inspect:async()=>assert.fail('failed binding cannot proceed')}),/binding-mismatch/)
  await assert.rejects(preparePhoneVideoSource(config,{checkOnly:false,prepare:async()=>{},inspect:async()=>{throw Error('size-not-restored')}}),/size-not-restored/)
})

test('WHIP compatibility removes TCP only where the same media or BUNDLE has usable UDP', async () => {
  const {udpCompatibleSdp}=await import('../scripts/phone-video-whip.mjs')
  const udp='a=candidate:1 1 udp 123 192.0.2.1 50000 typ host'
  const tcp='a=candidate:2 1 tcp 122 192.0.2.1 7881 typ host tcptype passive'
  const retained=['v=0','a=ice-ufrag:unit-test','a=ice-pwd:synthetic-unit-test-only','a=fingerprint:sha-256 TEST','m=video 9 UDP/TLS/RTP/SAVPF 96','a=mid:video',udp,'a=end-of-candidates',''].join('\r\n')
  const mixed=Buffer.from(retained.replace(udp,udp+'\r\n'+tcp))
  assert.equal(udpCompatibleSdp(mixed).body.toString(),retained)
  assert.equal(udpCompatibleSdp(mixed).removed,1)
  const unchanged=Buffer.from(retained);assert.equal(udpCompatibleSdp(unchanged).body,unchanged)
  assert.throws(()=>udpCompatibleSdp(Buffer.from(retained.replace(udp,tcp))),/udp-candidate-required/)
  assert.throws(()=>udpCompatibleSdp(Buffer.from(retained.replace(udp,udp.replace('50000','0')+'\r\n'+tcp))),/udp-candidate-required/)
  const twoMedia='v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:video\r\n'+udp+'\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:audio\r\n'+tcp+'\r\n'
  assert.throws(()=>udpCompatibleSdp(Buffer.from(twoMedia)),/udp-candidate-required/)
  assert.equal(udpCompatibleSdp(Buffer.from(twoMedia.replace('v=0','v=0\r\na=group:BUNDLE video audio'))).removed,1)
})
test('WHIP proxy rewrites only successful SDP POST bodies and frames the new body length', async () => {
  const answer='v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:v\r\na=candidate:1 1 udp 123 192.0.2.1 50000 typ host\r\na=candidate:2 1 tcp 122 192.0.2.1 7881 typ host tcptype passive\r\n'
  const proxy=await createWhipProxy('https://test.livekit.cloud/w/test-only-key',{fetchImpl:async()=>new Response(answer,{status:201,headers:{'content-type':'application/sdp','content-length':String(Buffer.byteLength(answer))}})})
  try {
    const response=await fetch(proxy.url,{method:'POST',body:'offer'}),body=await response.text()
    assert.equal(response.status,201);assert.ok(!body.includes(' 1 tcp '));assert.ok(body.includes(' 1 udp '))
    assert.ok(response.headers.get('content-length')===null || Number(response.headers.get('content-length'))===Buffer.byteLength(body))
  }finally{await proxy.close()}
  const plain=await createWhipProxy('https://test.livekit.cloud/w/test-only-key',{fetchImpl:async()=>new Response(answer,{status:200,headers:{'content-type':'text/plain'}})})
  try{assert.equal(await (await fetch(plain.url,{method:'POST',body:'offer'})).text(),answer)}finally{await plain.close()}
})

test('native failure diagnostics distinguish unavailable metadata from mismatches without leaking values', async()=>{
  const {safeCaptureFailure}=await import('../scripts/phone-video-core.mjs')
  for(const reason of ['source-native-title-unavailable','source-native-title-mismatch','source-native-position-changed','source-page-timeout','source-url-mismatch','source-viewport-height-changed','source-device-scale-changed'])assert.equal(safeCaptureFailure(reason+'\n'),reason)
  assert.equal(safeCaptureFailure('source-native-title-unavailable\nsource-page-timeout\n'),'source-page-timeout')
  assert.equal(safeCaptureFailure('source-url-mismatch: https://private.example/secret'),'none-or-suppressed')
  assert.equal(safeCaptureFailure('source-page-timeout\nprivate arbitrary error text'),'source-page-timeout')
})

test('actual native retry policy bounds owner rereads and never retries conflicts or dead processes',{skip:process.platform!=='darwin'},async()=>{
  const {readFile}=await import('node:fs/promises'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util')
  const source=await readFile(new URL('../scripts/phone-video-capture.swift',import.meta.url),'utf8')
  const policy=source.split('// BEGIN_OWNER_RETRY_POLICY')[1].split('// END_OWNER_RETRY_POLICY')[0]
  const dir=await mkdtemp(join(tmpdir(),'phone-owner-policy-'))
  try{
    const file=join(dir,'check.swift')
    await writeFile(file,policy+`
func exercise(_ reasons:[String],_ liveness:[Bool],_ expectReads:Int,_ expectPauses:Int,_ expectRecovery:Int,_ expectSuccess:Bool) {
 var reads=0,pauses=0,recoveries=0,aliveReads=0,reason=""
 let result:Int?=OwnerMetadataRetry.perform(read:{reason=reasons[min(reads,reasons.count-1)];reads+=1;return reason=="success" ? 7:nil},reason:{reason},alive:{let value=liveness[min(aliveReads,liveness.count-1)];aliveReads+=1;return value},pause:{pauses+=1},recovered:{recoveries+=1})
 precondition(reads==expectReads && pauses==expectPauses && recoveries==expectRecovery && (result != nil)==expectSuccess)
}
exercise(["source-owner-unavailable","success"],[true],2,1,1,true)
exercise(["source-owner-unavailable"],[true],3,2,0,false)
exercise(["source-owner-unavailable"],[false],1,0,0,false)
exercise(["source-owner-unavailable","success"],[true,false],1,1,0,false)
exercise(["source-owner-unavailable","source-url-mismatch","success"],[true],2,1,0,false)
for reason in ["source-owner-mismatch","source-native-title-unavailable","source-native-title-mismatch","source-native-size-changed","source-url-mismatch","source-page-timeout"] {exercise([reason,"success"],[true],1,0,0,false)}
`)
    await promisify(execFile)('/usr/bin/swift',[file],{timeout:20000,maxBuffer:4096})
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('actual native origin policy permits only an unchanged-size uniquely bound move',{skip:process.platform!=='darwin'},async()=>{
  const {readFile}=await import('node:fs/promises'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util')
  const source=await readFile(new URL('../scripts/phone-video-capture.swift',import.meta.url),'utf8')
  const policy=source.split('// BEGIN_ORIGIN_POLICY')[1].split('// END_ORIGIN_POLICY')[0]
  const dir=await mkdtemp(join(tmpdir(),'phone-origin-policy-'))
  try{
    const file=join(dir,'check.swift')
    await writeFile(file,'import CoreGraphics\n'+policy+`
let old=CGRect(x:10,y:40,width:406,height:851), moved=CGRect(x:30,y:40,width:406,height:851)
precondition(SourceOriginPolicy.accepts(previous:old,native:moved,browser:moved,uniqueMatches:1,pageUnchanged:true))
precondition(!SourceOriginPolicy.accepts(previous:old,native:moved,browser:old,uniqueMatches:1,pageUnchanged:true))
precondition(!SourceOriginPolicy.accepts(previous:old,native:moved,browser:moved,uniqueMatches:2,pageUnchanged:true))
precondition(!SourceOriginPolicy.accepts(previous:old,native:moved,browser:moved,uniqueMatches:1,pageUnchanged:false))
let resized=CGRect(x:30,y:40,width:440,height:851)
precondition(!SourceOriginPolicy.accepts(previous:old,native:resized,browser:resized,uniqueMatches:1,pageUnchanged:true))
`)
    await promisify(execFile)('/usr/bin/swift',[file],{timeout:20000,maxBuffer:4096})
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('actual native page rules allow only the profile or a coin on a fresh follow list',{skip:process.platform!=='darwin'},async()=>{
  const {readFile}=await import('node:fs/promises'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util')
  const source=await readFile(new URL('../scripts/phone-video-capture.swift',import.meta.url),'utf8')
  const rules=source.split('// BEGIN_PAGE_RULES')[1].split('// END_PAGE_RULES')[0]
  const dir=await mkdtemp(join(tmpdir(),'phone-page-rules-'))
  try{
    const file=join(dir,'check.swift'), follow=join(dir,'follow.json')
    const A='ANVLA6eKiAq4nstD2Sg3SZhfVkSEwfnGccn12UQWpump'
    await writeFile(follow,JSON.stringify({mints:[A],updatedAt:Date.now()}))
    await writeFile(file,'import Foundation\nstruct Pin { let title: String; let browserUrl: String; let followFile: String? }\n'+rules+`
let r=PageRules(Pin(title:"GrokGrid | Pump",browserUrl:"https://pump.fun/profile/GrokGrid",followFile:${JSON.stringify(follow)}))
precondition(r.urlAllowed("https://pump.fun/profile/GrokGrid"))
precondition(r.urlAllowed("https://pump.fun/coin/${A}"))
precondition(!r.urlAllowed("https://pump.fun/coin/9KhzhyM1BwgW6myZRcqdzQvemKjVrjck8kaevTkMpump"))
precondition(!r.urlAllowed("https://pump.fun/coin/${A}?x=1"))
precondition(!r.urlAllowed("https://evil.example/coin/${A}"))
precondition(r.titleAllowed("Hexncoin (HEXN) Price, Chart & Market Cap | Pump"))
precondition(!r.titleAllowed("Inbox"))
let stale=PageRules(Pin(title:"GrokGrid | Pump",browserUrl:"https://pump.fun/profile/GrokGrid",followFile:nil))
precondition(!stale.urlAllowed("https://pump.fun/coin/${A}"))
`)
    await promisify(execFile)('/usr/bin/swift',[file],{timeout:30000,maxBuffer:4096})
  }finally{await rm(dir,{recursive:true,force:true})}
})
