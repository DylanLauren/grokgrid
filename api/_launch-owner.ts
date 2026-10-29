// Public wallet identity is not authority. Only send.ts may claim an owner, after
// verifying the complete wallet-signed launch transaction. Preparing never claims it.
import { HOUSE_WALLET, isAddress, parse, redis } from './_lib.js'
export const ownerKeys = { hold: (owner: string) => `gg:owner:hold:${owner}`, agent: (owner: string) => `gg:owner:agent:${owner}` }
export const OWNER_CHECK_LUA = `
local function address(v) return type(v)=='string' and #v>=32 and #v<=44 and not string.find(v,'[^1-9A-HJ-NP-Za-km-z]') end
local function agentId(v) return type(v)=='string' and #v>=1 and #v<=96 and string.match(v,'^[%w_%-]+$') end
local owner=ARGV[1]
if not address(owner) then return cjson.encode({state='review'}) end
local expected={'string','string','hash','set'}
for i,want in ipairs(expected) do local t=redis.call('TYPE',KEYS[i]).ok if t~='none' and t~=want then return cjson.encode({state='review'}) end end
local confirmed=redis.call('GET',KEYS[2])
if confirmed then
 local ok,c=pcall(cjson.decode,confirmed)
 if ok and type(c)=='table' and agentId(c.agentId) and address(c.mint) then return cjson.encode({state='confirmed',agentId=c.agentId,mint=c.mint}) end
 return cjson.encode({state='review'})
end
for _,raw in ipairs(redis.call('HVALS',KEYS[3])) do
 local ok,r=pcall(cjson.decode,raw)
 if not ok or type(r)~='table' or not address(r.owner) or not address(r.wallet) or not agentId(r.id) or type(r.coin)~='table' or not address(r.coin.mint) then return cjson.encode({state='review'}) end
 if r.owner==owner or r.wallet==owner then
  return cjson.encode({state='confirmed',agentId=r.id,mint=r.coin and r.coin.mint or nil})
 end
end
local hold=redis.call('GET',KEYS[1])
if hold then
 if not address(hold) then return cjson.encode({state='review'}) end
 local raw=redis.call('GET','gg:launch:'..hold)
 if not raw then return cjson.encode({state='review',mint=hold}) end
 return cjson.encode({state='reserved',mint=hold})
end
for _,mint in ipairs(redis.call('SMEMBERS',KEYS[4])) do
 if not address(mint) then return cjson.encode({state='review'}) end
 local raw=redis.call('GET','gg:launch:'..mint)
 if not raw then return cjson.encode({state='review'}) end
 local ok,p=pcall(cjson.decode,raw)
 if not ok or type(p)~='table' or not address(p.launcher) then return cjson.encode({state='review'}) end
 if p.launcher==owner then return cjson.encode({state='review',mint=mint}) end
end
return cjson.encode({state='available'})
`
export const CLAIM_OWNER_LUA = `
local t=redis.call('TYPE',KEYS[5]).ok; if t~='none' and t~='string' then return 'review' end
if redis.call('GET',KEYS[5])~=ARGV[3] then return 'stale' end
local check=function() ${OWNER_CHECK_LUA} end
local status=cjson.decode(check())
if status.state~='available' then return status.state end
redis.call('SET',KEYS[1],ARGV[2])
redis.call('SET',KEYS[5],ARGV[4])
redis.call('SADD',KEYS[4],ARGV[2])
return 'claimed'
`
export const SAVE_PREPARED_LUA = `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) return 1`
export const RELEASE_PREPARE_LUA = `if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end return redis.call('DEL',KEYS[1])`
export type OwnerState = { state: 'available' | 'reserved' | 'confirmed' | 'review'; mint?: string; agentId?: string }
export async function launchOwnerState(owner: string): Promise<OwnerState> {
  if (!isAddress(owner)||owner===HOUSE_WALLET||owner===process.env.VITE_BURN_WALLET) return { state: 'review' }
  const [raw] = await redis(['EVAL', OWNER_CHECK_LUA, 4, ownerKeys.hold(owner), ownerKeys.agent(owner), 'gg:agents', 'gg:launch:open', owner])
  const state=parse<OwnerState>(raw)
  if(!state||!['available','reserved','confirmed','review'].includes(state.state)||(state.mint!==undefined&&!isAddress(state.mint))||(state.agentId!==undefined&&(typeof state.agentId!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(state.agentId))))throw Error('Owner state unavailable.')
  return state
}
export async function claimLaunchOwner(owner:string,mint:string,expected:string,recovery:string):Promise<boolean>{
  if(!isAddress(owner)||!isAddress(mint)||owner===HOUSE_WALLET||owner===process.env.VITE_BURN_WALLET)return false
  const [result]=await redis(['EVAL',CLAIM_OWNER_LUA,5,ownerKeys.hold(owner),ownerKeys.agent(owner),'gg:agents','gg:launch:open',`gg:launch:${mint}`,owner,mint,expected,recovery])
  return result==='claimed'
}
export async function savePrepared(mint:string,expected:string,record:string,ttl:number):Promise<boolean>{
  const [ok]=await redis(['EVAL',SAVE_PREPARED_LUA,1,`gg:launch:${mint}`,expected,record,ttl]);return Number(ok)===1
}
export async function releasePreparation(mint:string,expected:string){await redis(['EVAL',RELEASE_PREPARE_LUA,1,`gg:launch:${mint}`,expected])}
