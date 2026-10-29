import test from 'node:test'
import assert from 'node:assert/strict'
process.env.UPSTASH_REDIS_REST_URL='https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN='test-only'
process.env.VITE_BOT_WALLET='GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
process.env.VITE_BURN_WALLET='E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq'
const {POST:send}=await import('../api/launch/send.ts')
const {GET:status}=await import('../api/launch/status.ts')
const {finishLaunch}=await import('../api/_finish.ts')
const {launchStatus}=await import('../api/_launch.ts')
const {claimLaunchOwner,launchOwnerState}=await import('../api/_launch-owner.ts')
const mint='So11111111111111111111111111111111111111112',owner='11111111111111111111111111111111'
async function mockRedis(fn:(cmd:any[])=>unknown,work:()=>Promise<void>){const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://redis.test/pipeline');const cmds=JSON.parse(String(init?.body));return Response.json(cmds.map((cmd:any[])=>({result:fn(cmd)})))};try{await work()}finally{globalThis.fetch=original}}

test('invalid signed launch cannot claim an owner or broadcast; legacy pending launches remain held',async()=>{
 for(const version of [undefined,2]){
  const calls:any[][]=[]
  await mockRedis(cmd=>{calls.push(cmd);if(cmd[0]==='GET')return JSON.stringify({routingVersion:version,launcher:owner,bot:owner,message:'invalid-message',signature:null,setup:null});return 1},async()=>{
   const response=await send(new Request('https://example.test/api/launch/send',{method:'POST',body:JSON.stringify({mint,tx:'invalid-transaction'})}))
   assert.equal(response.status,version===2?400:409)
  })
  assert.ok(calls.every(cmd=>['GET','INCR','EXPIRE'].includes(cmd[0])))
 }
})

test('missing or legacy ambiguous pending records are not removed during status reconciliation',async()=>{
 for(const raw of [null,JSON.stringify({draft:{},bot:owner,launcher:owner,signature:'legacy'})]){
  const calls:any[][]=[]
  await mockRedis(cmd=>{calls.push(cmd);return cmd[1]===`gg:launch:${mint}`?raw:null},async()=>assert.equal((await finishLaunch(mint)).status,409))
  assert.ok(calls.every(cmd=>cmd[0]==='GET'))
 }
})

test('launcher model stays paused and reserved platform wallets cannot claim another agent',async()=>{
 const result=await launchStatus();assert.equal(result.open,false);assert.equal(result.walletModel,'launcher');assert.equal(result.oneAgentPerWallet,true)
 for(const wallet of [process.env.VITE_BOT_WALLET!,process.env.VITE_BURN_WALLET!]){
  assert.deepEqual(await launchOwnerState(wallet),{state:'review'})
  assert.equal(await claimLaunchOwner(wallet,mint,'unused','unused'),false)
 }
})

test('owner-aware status is uncached, exposes correct contract, and fails closed on limiter failures',async()=>{
 await mockRedis(cmd=>cmd[0]==='SRANDMEMBER'?[]:cmd[0]==='EVAL'?JSON.stringify({state:'available'}):1,async()=>{
  const response=await status(new Request(`https://example.test/api/launch/status?launcher=${owner}`))
  const body=await response.json();assert.equal(body.open,false);assert.equal(body.walletModel,'launcher');assert.equal(body.oneAgentPerWallet,true);assert.deepEqual(body.ownerState,{state:'available'});assert.equal(response.headers.get('cache-control'),'no-store')
 })
 await mockRedis(()=>null,async()=>assert.equal((await status(new Request(`https://example.test/api/launch/status?launcher=${owner}`))).status,503))
 assert.equal((await status(new Request('https://example.test/api/launch/status?launcher=invalid'))).status,400)
})
