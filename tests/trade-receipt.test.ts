import test from 'node:test'
import assert from 'node:assert/strict'
process.env.UPSTASH_REDIS_REST_URL = 'https://receipt-redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-only'
process.env.INGEST_TOKEN = 'receipt-test-only'
process.env.VITE_BOT_WALLET = 'GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT'
const { inspectTradeReceipt } = await import('../api/_trade-receipt')
const { POST } = await import('../api/ingest')
const wallet = process.env.VITE_BOT_WALLET
const mint = '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump'
const signature = '2'.repeat(88)
const balance = (amount: string) => ({ accountIndex: 1, owner: wallet, mint, uiTokenAmount: { amount, decimals: 6 } })
const tx = () => ({ blockTime: 1_800_000_000, meta: { err: null, fee: 5000, preBalances: [2_000_000_000, 0], postBalances: [998_000_000, 1_995_000], preTokenBalances: [], postTokenBalances: [balance('100000000')] }, transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: wallet, signer: true }, { pubkey: 'token-account', signer: false }] } } })
test('receipt checks exact wallet, owned mint, side and SOL movement with ATA rent and fee removed', () => {
 const result = inspectTradeReceipt(tx(), wallet, mint, 'buy')
 assert.equal(result.ok, true)
 if(result.ok) { assert.equal(result.solFlowLamports, '1000000000'); assert.equal(result.tokenAmountRaw, '100000000'); assert.equal(result.accountingVerified, false) }
 assert.equal(inspectTradeReceipt(tx(), wallet, mint, 'sell').ok, false)
 assert.equal(inspectTradeReceipt(tx(), 'different-wallet', mint, 'buy').ok, false)
 assert.equal(inspectTradeReceipt(tx(), wallet, 'different-mint', 'buy').ok, false)
 const failed = tx(); failed.meta.err = { InstructionError: [] } as never
 assert.equal(inspectTradeReceipt(failed, wallet, mint, 'buy').ok, false)
 const noPayment = tx(); noPayment.meta.postBalances[0] = 1_998_000_000
 assert.equal(inspectTradeReceipt(noPayment, wallet, mint, 'buy').ok, false)
})
test('receipt handles a closed owned token account on a sell without counting rent as proceeds', () => {
 const t = tx(); t.meta.preTokenBalances = [balance('100000000')] as never; t.meta.postTokenBalances = []
 t.meta.preBalances=[1_000_000_000, 1_995_000]; t.meta.postBalances=[2_001_990_000,0]
 const r=inspectTradeReceipt(t,wallet,mint,'sell')
 assert.equal(r.ok,true); if(r.ok)assert.equal(r.solFlowLamports,'1000000000')
})
test('ingest retries persist only once and do not promote reported USD PnL into statistics', async () => {
 const original=globalThis.fetch; const saved=new Set(); const persisted: Record<string,unknown>[]=[]; let increments=0
 try {
  globalThis.fetch=async(input,init)=>{
   if(String(input).includes('receipt-redis.test')){
    const commands=JSON.parse(String(init?.body))
    return Response.json(commands.map((cmd: unknown[])=>{
     if(cmd[0]==='EVAL'){
      assert.doesNotMatch(String(cmd[1]),/'wins'|'pnlSol'|'sells'/)
      const key=String(cmd[6]); if(saved.has(key))return {result:0}; saved.add(key);persisted.push(JSON.parse(String(cmd[7])));increments++;return {result:1}
     }
     return {result:1}
    }))
   }
   const request=JSON.parse(String(init?.body));assert.equal(request.params[1].commitment,'finalized');return Response.json({result:tx()})
  }
  const send=()=>POST(new Request('https://example.test/api/ingest',{method:'POST',headers:{authorization:'Bearer receipt-test-only'},body:JSON.stringify({type:'trade',agent:'house',side:'buy',mint,sig:signature,spentSol:999,pnlUsd:1e12,positionUsd:1e13,sizeTokens:1})}))
  const first=await send(),again=await send()
  assert.equal(first.status,200); assert.equal((await first.json()).duplicate,false)
  assert.equal((await again.json()).duplicate,true);assert.equal(increments,1)
  assert.equal(persisted[0].spentSol,1);assert.equal(persisted[0].sizeTokens,100)
  assert.equal(persisted[0].pnlUsd,null);assert.equal(persisted[0].accountingVerified,false)
 } finally {globalThis.fetch=original}
})
test('missing finalized receipt fails closed before persisting a trade', async()=>{
 const original=globalThis.fetch;let writes=0
 try {globalThis.fetch=async(input,init)=>{
  if(String(input).includes('receipt-redis.test')) {const c=JSON.parse(String(init?.body));writes+=c.filter((x:unknown[])=>x[0]==='EVAL').length;return Response.json(c.map(()=>({result:1})))}
  return Response.json({result:null})
 }
 const r=await POST(new Request('https://example.test/api/ingest',{method:'POST',headers:{authorization:'Bearer receipt-test-only'},body:JSON.stringify({type:'trade',agent:'house',side:'buy',mint,sig:signature})}))
 assert.equal(r.status,503);assert.equal(writes,0)
 }finally{globalThis.fetch=original}
})

test('wrong-type store refusal is not acknowledged as persisted success', async()=>{
 const original=globalThis.fetch
 try {globalThis.fetch=async(input,init)=>{
  if(String(input).includes('receipt-redis.test')) {
   const commands=JSON.parse(String(init?.body))
   return Response.json(commands.map((cmd:unknown[])=>{
    if(cmd[0]==='EVAL') {
     const lua=String(cmd[1]); assert.ok(lua.indexOf("redis.call('TYPE'")<lua.indexOf("redis.call('SADD'"))
     assert.match(lua,/kind ~= 'none' and kind ~= expected\[i\] then return -1/)
     return {result:-1}
    }
    return {result:1}
   }))
  }
  return Response.json({result:tx()})
 }
 const r=await POST(new Request('https://example.test/api/ingest',{method:'POST',headers:{authorization:'Bearer receipt-test-only'},body:JSON.stringify({type:'trade',agent:'house',side:'buy',mint,sig:signature})}))
 assert.equal(r.status,503);assert.equal((await r.json()).ok,undefined)
 }finally{globalThis.fetch=original}
})
