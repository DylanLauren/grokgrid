import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import { localRedis } from './helpers/local-redis.ts'
import { OWNER_CHECK_LUA, CLAIM_OWNER_LUA, SAVE_PREPARED_LUA, RELEASE_PREPARE_LUA } from '../api/_launch-owner.ts'
import { FINALIZE_OWNER_LUA } from '../api/_launch-finalize.ts'
const binary=process.env.GROKGRID_TEST_REDIS_SERVER
const owner='11111111111111111111111111111111',mintA='So11111111111111111111111111111111111111112',mintB='GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const ownerKeys=(o=owner)=>[`gg:owner:hold:${o}`,`gg:owner:agent:${o}`,'gg:agents','gg:launch:open']
async function fixture(fn:(r:Awaited<ReturnType<typeof localRedis>>)=>Promise<void>){const r=await localRedis(binary!);try{await fn(r)}finally{await r.close()}}
const evalLua=(r:any,script:string,keys:string[],args:any[])=>r.command('EVAL',script,keys.length,...keys,...args)
const prepared=(mint:string)=>JSON.stringify({routingVersion:2,launcher:owner,bot:owner,mint,message:'fixture-only',signature:null})
const recovery=(mint:string)=>JSON.stringify({routingVersion:2,launcher:owner,bot:owner,mint,authorizedSignature:'fixture-only',signature:null,sending:true,phase:'setup-pending'})
const claim=(r:any,mint:string)=>evalLua(r,CLAIM_OWNER_LUA,[...ownerKeys(),`gg:launch:${mint}`],[owner,mint,prepared(mint),recovery(mint)])
function finishKeys(mint:string,o=owner){return [`gg:mint:${mint}`,`gg:owner:hold:${o}`,`gg:owner:agent:${o}`,'gg:agents',`gg:launch:${mint}`,`gg:img:${mint}`,`gg:meta:${mint}`,'gg:launches','gg:launch:open','gg:launch:event-payloads','gg:launch:event-order','gg:launch:event-sequence']}
const finishArgs=(mint:string,id='test-agent',ts=100)=>[mint,owner,id,JSON.stringify({id,owner,wallet:owner,coin:{mint},launchedAt:999}),JSON.stringify({id,mint,wallet:owner,ts}),recovery(mint)]

test('real Redis: unsigned drafts coexist without owner claim and expired preparation cannot overwrite a replacement',{skip:!binary},async()=>fixture(async r=>{
 for(const mint of [mintA,mintB])await r.command('SET',`gg:launch:${mint}`,'placeholder','PX',50)
 assert.equal(JSON.parse(await evalLua(r,OWNER_CHECK_LUA,ownerKeys(),[owner])).state,'available')
 assert.equal(await r.command('EXISTS',ownerKeys()[0]),0)
 await new Promise(resolve=>setTimeout(resolve,70))
 await r.command('SET',`gg:launch:${mintA}`,'new-placeholder','EX',900)
 assert.equal(await evalLua(r,SAVE_PREPARED_LUA,[`gg:launch:${mintA}`],['placeholder',prepared(mintA),900]),0)
 assert.equal(await evalLua(r,RELEASE_PREPARE_LUA,[`gg:launch:${mintA}`],['placeholder']),0)
 assert.equal(await r.command('GET',`gg:launch:${mintA}`),'new-placeholder')
}))

test('real Redis: competing authorized submissions permit exactly one owner claim and retain ambiguous holds',{skip:!binary},async()=>fixture(async r=>{
 for(const mint of [mintA,mintB])await r.command('SET',`gg:launch:${mint}`,prepared(mint),'EX',900)
 const outcomes=await Promise.all([claim(r,mintA),claim(r,mintB)])
 assert.equal(outcomes.filter(x=>x==='claimed').length,1);assert.equal(outcomes.filter(x=>x==='reserved').length,1)
 const winner=outcomes[0]==='claimed'?mintA:mintB
 assert.equal(await r.command('TTL',ownerKeys()[0]),-1);assert.equal(await r.command('TTL',`gg:launch:${winner}`),-1)
 assert.equal(await claim(r,winner),'stale')
 assert.equal(JSON.parse(await evalLua(r,OWNER_CHECK_LUA,ownerKeys(),[owner])).state,'reserved')
}))

test('real Redis: corrupt store types and unknown legacy ownership fail before permanent claims',{skip:!binary},async()=>fixture(async r=>{
 await r.command('SET',`gg:launch:${mintA}`,prepared(mintA),'EX',900)
 await r.command('SET','gg:launch:open','wrong-type')
 assert.equal(await claim(r,mintA),'review');assert.equal(await r.command('EXISTS',ownerKeys()[0]),0)
 await r.command('DEL','gg:launch:open');await r.command('HSET','gg:agents','broken','bad-json')
 assert.equal(await claim(r,mintA),'review');assert.equal(await r.command('EXISTS',ownerKeys()[0]),0)
 await r.command('HSET','gg:agents','broken',JSON.stringify({owner:'',wallet:'',id:'',coin:{mint:''}}))
 assert.equal(await claim(r,mintA),'review');assert.equal(await r.command('EXISTS',ownerKeys()[0]),0)
 await r.command('DEL','gg:agents');await r.command('SADD','gg:launch:open',mintB)
 await r.command('SET',`gg:launch:${mintB}`,JSON.stringify({launcher:owner,signature:'legacy-signed'}))
 assert.equal(await claim(r,mintA),'review');assert.equal(await r.command('EXISTS',ownerKeys()[0]),0)
}))

test('real Redis: confirmation is idempotent, owner unique, outbox immutable and untrimmed beyond 50',{skip:!binary},async()=>fixture(async r=>{
 await r.command('SET',`gg:launch:${mintA}`,prepared(mintA),'EX',900);assert.equal(await claim(r,mintA),'claimed')
 const result=await Promise.all([evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA)),evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA,'test-agent',200))])
 assert.deepEqual(result,['test-agent','test-agent']);assert.equal(await r.command('ZCARD','gg:launch:event-order'),1);assert.equal(await r.command('LLEN','gg:launches'),1)
 const event=JSON.parse(await r.command('HGET','gg:launch:event-payloads',mintA));assert.ok([100,200].includes(event.ts));await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA,'test-agent',999));assert.equal(JSON.parse(await r.command('HGET','gg:launch:event-payloads',mintA)).ts,event.ts)
 assert.deepEqual(JSON.parse(await r.command('GET',ownerKeys()[1])),{agentId:'test-agent',mint:mintA})
 await r.command('SET',`gg:launch:${mintB}`,prepared(mintB),'EX',900);assert.equal(await claim(r,mintB),'confirmed')
 for(let i=0;i<60;i++){
  const mint=new PublicKey(new Uint8Array(32).fill(i+1)).toBase58(),o=new PublicKey(new Uint8Array(32).fill(i+101)).toBase58(),id=`fixture-agent-${i}`,pending='fixture-pending'
  await r.command('SET',`gg:owner:hold:${o}`,mint);await r.command('SET',`gg:launch:${mint}`,pending)
  const args=[mint,o,id,JSON.stringify({id,owner:o,wallet:o,coin:{mint}}),JSON.stringify({id,mint,wallet:o,ts:100+i}),pending]
  assert.equal(await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mint,o),args),id)
 }
 assert.equal(await r.command('ZCARD','gg:launch:event-order'),61);assert.equal(await r.command('HLEN','gg:launch:event-payloads'),61);assert.equal(await r.command('LLEN','gg:launches'),61)
}))

test('real Redis: finalization type and identity conflicts leave outbox and owner untouched',{skip:!binary},async()=>fixture(async r=>{
 await r.command('SET',`gg:launch:${mintA}`,prepared(mintA),'EX',900);await claim(r,mintA)
 await r.command('SET','gg:launches','wrong-type')
 assert.equal(await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA)),'!store-type')
 assert.equal(await r.command('EXISTS','gg:launch:event-payloads'),0);assert.equal(await r.command('EXISTS',ownerKeys()[1]),0)
 await r.command('DEL','gg:launches');await r.command('HSET','gg:agents','test-agent',JSON.stringify({id:'test-agent',wallet:mintB,owner:mintB,coin:{mint:mintB}}))
 assert.equal(await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA)),'!registry-collision')
 assert.equal(await r.command('GET',ownerKeys()[0]),mintA);assert.equal(await r.command('EXISTS','gg:launch:event-payloads'),0)
}))


test('real Redis: noncanonical counter rejects before HSETNX and partial event retry preserves its original identity/time',{skip:!binary},async()=>fixture(async r=>{
 await r.command('SET',`gg:launch:${mintA}`,prepared(mintA),'EX',900);await claim(r,mintA)
 await r.command('SET','gg:launch:event-sequence','01')
 assert.equal(await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA)),'!sequence-invalid')
 assert.equal(await r.command('EXISTS','gg:launch:event-payloads'),0)
 await r.command('SET','gg:launch:event-sequence','0')
 await r.command('HSET','gg:launch:event-payloads',mintA,JSON.stringify({id:'test-agent',mint:mintA,wallet:owner,ts:77}))
 assert.equal(await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA,'test-agent',999)),'test-agent')
 assert.equal(JSON.parse(await r.command('HGET','gg:launch:event-payloads',mintA)).ts,77)
 assert.equal(JSON.parse(await r.command('HGET','gg:agents','test-agent')).launchedAt,77)
 assert.equal(await r.command('ZSCORE','gg:launch:event-order',mintA),'1')
}))


test('real Redis: unsafe stored event timestamps cannot commit an unreadable outbox',{skip:!binary},async()=>fixture(async r=>{
 await r.command('SET',`gg:launch:${mintA}`,prepared(mintA),'EX',900);await claim(r,mintA)
 await r.command('HSET','gg:launch:event-payloads',mintA,JSON.stringify({id:'test-agent',mint:mintA,wallet:owner,ts:Number.MAX_SAFE_INTEGER+1}))
 assert.equal(await evalLua(r,FINALIZE_OWNER_LUA,finishKeys(mintA),finishArgs(mintA)),'!event-conflict')
 assert.equal(await r.command('EXISTS',ownerKeys()[1]),0);assert.equal(await r.command('ZCARD','gg:launch:event-order'),0)
}))
