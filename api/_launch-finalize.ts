// Atomic local registry/outbox finalization after independent on-chain checks.
// No network or financial transaction execution occurs in this script.
export const FINALIZE_OWNER_LUA = `
local function address(v) return type(v)=='string' and #v>=32 and #v<=44 and not string.find(v,'[^1-9A-HJ-NP-Za-km-z]') end
local function agentId(v) return type(v)=='string' and #v>=1 and #v<=96 and string.match(v,'^[%w_%-]+$') end
-- ARGV[2] owns the bot (the launching wallet); ARGV[7] is its trading wallet, the same one unless
-- the owner launched from their own wallet and funded a separate bot wallet.
local wallet=ARGV[7] or ARGV[2]
if not address(ARGV[1]) or not address(ARGV[2]) or not address(wallet) or not agentId(ARGV[3]) then return '!identity-invalid' end
local expected={'string','string','string','hash','string','string','string','list','set','hash','zset','string'}
for i,want in ipairs(expected) do local t=redis.call('TYPE',KEYS[i]).ok if t~='none' and t~=want then return '!store-type' end end
local done=redis.call('GET',KEYS[1]); if done then return done end
if redis.call('GET',KEYS[5])~=ARGV[6] then return '!pending-changed' end
local hold=redis.call('GET',KEYS[2]); if hold and hold~=ARGV[1] then return '!owner-conflict' end
local confirmed=redis.call('GET',KEYS[3])
if confirmed then
 local ok,c=pcall(cjson.decode,confirmed)
 if not ok or type(c)~='table' or c.agentId~=ARGV[3] or c.mint~=ARGV[1] then return '!owner-conflict' end
elseif hold~=ARGV[1] then return '!owner-unclaimed' end
local ok,record=pcall(cjson.decode,ARGV[4]); if not ok or type(record)~='table' or record.id~=ARGV[3] or record.wallet~=wallet or record.owner~=ARGV[2] or type(record.coin)~='table' or record.coin.mint~=ARGV[1] then return '!record-invalid' end
for _,raw in ipairs(redis.call('HVALS',KEYS[4])) do
 local parsed,r=pcall(cjson.decode,raw)
 if not parsed or type(r)~='table' or not address(r.owner) or not address(r.wallet) or not agentId(r.id) or type(r.coin)~='table' or not address(r.coin.mint) then return '!registry-invalid' end
 if r.id==ARGV[3] and (r.wallet~=wallet or not r.coin or r.coin.mint~=ARGV[1] or r.owner~=ARGV[2]) then return '!registry-collision' end
 if (r.owner==ARGV[2] or r.wallet==ARGV[2] or r.owner==wallet or r.wallet==wallet) and r.id~=ARGV[3] then return '!owner-conflict' end
end
local stored=redis.call('HGET',KEYS[10],ARGV[1]); local eventRaw=stored or ARGV[5]
local parsed,event=pcall(cjson.decode,eventRaw)
if not parsed or type(event)~='table' or event.id~=ARGV[3] or event.mint~=ARGV[1] or event.wallet~=wallet or type(event.ts)~='number' or event.ts<1 or event.ts>9007199254740991 or event.ts~=math.floor(event.ts) then return '!event-conflict' end
local score=redis.call('ZSCORE',KEYS[11],ARGV[1]); if score and not stored then return '!event-conflict' end
local sequence=redis.call('GET',KEYS[12]) or '0'
if sequence~='0' and not string.match(sequence,'^[1-9]%d*$') then return '!sequence-invalid' end
local seq=tonumber(sequence); if not seq or seq>=9007199254740990 then return '!sequence-invalid' end
local last=redis.call('ZREVRANGE',KEYS[11],0,0,'WITHSCORES')
if #last>0 and (tonumber(last[2])>seq or tonumber(last[2])~=math.floor(tonumber(last[2]))) then return '!sequence-invalid' end
if score and (tonumber(score)<1 or tonumber(score)>seq or tonumber(score)~=math.floor(tonumber(score))) then return '!sequence-invalid' end
-- Every possible input/type/counter failure above precedes writes.
local newEvent=redis.call('HSETNX',KEYS[10],ARGV[1],eventRaw)
if not score then local n=redis.call('INCR',KEYS[12]); redis.call('ZADD',KEYS[11],'NX',n,ARGV[1]) end
record.launchedAt=event.ts
redis.call('HSET',KEYS[4],ARGV[3],cjson.encode(record))
redis.call('SET',KEYS[3],cjson.encode({agentId=ARGV[3],mint=ARGV[1]}))
redis.call('PERSIST',KEYS[6]); redis.call('PERSIST',KEYS[7])
if newEvent==1 then redis.call('LPUSH',KEYS[8],eventRaw); redis.call('LTRIM',KEYS[8],0,199) end
redis.call('DEL',KEYS[2])
redis.call('SREM',KEYS[9],ARGV[1])
redis.call('SET',KEYS[1],ARGV[3])
return ARGV[3]
`
