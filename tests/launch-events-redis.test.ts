import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import { localRedis } from './helpers/local-redis.ts'
process.env.UPSTASH_REDIS_REST_URL='https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN='test-only'
process.env.INGEST_TOKEN='test-ingest-only'
const {GET}=await import('../api/launch/events.ts')
const binary=process.env.GROKGRID_TEST_REDIS_SERVER
const mint=(i:number)=>new PublicKey(new Uint8Array(32).fill(i)).toBase58()
const event=(i:number)=>({id:`agent-${i}`,mint:mint(i),wallet:mint(i+100),ts:1700000000000+i})
const request=(after='0')=>new Request(`https://example.test/api/launch/events?after=${after}&limit=50`,{headers:{authorization:'Bearer test-ingest-only'}})
async function fixture(fn:(r:Awaited<ReturnType<typeof localRedis>>)=>Promise<void>){
 const r=await localRedis(binary!),original=globalThis.fetch
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://redis.test/pipeline')
  const commands=JSON.parse(String(init?.body));assert.ok(commands.every((c:any[])=>c[0]==='EVAL'))
  return Response.json(await Promise.all(commands.map(async(c:any[])=>({result:await r.command(...c)}))))
 }
 try{await fn(r)}finally{globalThis.fetch=original;await r.close()}
}
async function seed(r:any,i:number,cursor=i){await r.command('HSET','gg:launch:event-payloads',mint(i),JSON.stringify(event(i)));await r.command('ZADD','gg:launch:event-order',cursor,mint(i))}

test('real Redis endpoint: 61 records paginate 0 to 50 to 61 without cap or acknowledgement',{skip:!binary},async()=>fixture(async r=>{
 for(let i=1;i<=61;i++)await seed(r,i)
 const first=await GET(request());assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'no-store')
 const a=await first.json();assert.equal(a.events.length,50);assert.equal(a.nextCursor,'50');assert.equal(a.headCursor,'61');assert.equal(a.hasMore,true);assert.equal(a.executionEnabled,false)
 const b=await (await GET(request(a.nextCursor))).json();assert.equal(b.events.length,11);assert.equal(b.nextCursor,'61');assert.equal(b.hasMore,false)
 assert.equal(await r.command('ZCARD','gg:launch:event-order'),61)
}))

test('real Redis endpoint: sequence gaps are valid but missing/corrupt payload never advances cursor',{skip:!binary},async()=>fixture(async r=>{
 await seed(r,1,10);await seed(r,2,20)
 const good=await GET(request());assert.equal(good.status,200);assert.deepEqual((await good.json()).events.map((x:any)=>x.cursor),['10','20'])
 await r.command('HDEL','gg:launch:event-payloads',mint(2))
 const missing=await GET(request());assert.equal(missing.status,503);assert.equal((await missing.json()).nextCursor,undefined)
 await r.command('HSET','gg:launch:event-payloads',mint(2),'corrupt-json')
 const corrupt=await GET(request());assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).events,undefined)
 assert.equal(await r.command('ZCARD','gg:launch:event-order'),2)
}))
