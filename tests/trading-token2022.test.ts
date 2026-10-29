import test from 'node:test'
import assert from 'node:assert/strict'
import { PublicKey } from '@solana/web3.js'
import { MintLayout, AccountLayout, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { pack } from '@solana/spl-token-metadata'
import { inspectPositionResponses, collectFinalizedPositions } from '../scripts/trading-positions.mjs'
const wallet='GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT', mint='E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq', ata='3F59imZbLqz4GW5F2TijmU2oSrQC8gakzovTPy4tYrLQ'
const program=TOKEN_2022_PROGRAM_ID.toBase58(), zero=PublicKey.default, now=1700000000000
function tlv(type:number,data=Buffer.alloc(0)){const header=Buffer.alloc(4);header.writeUInt16LE(type);header.writeUInt16LE(data.length,2);return Buffer.concat([header,data])}
const metadata=Buffer.from(pack({mint:new PublicKey(mint),name:'Observed token',symbol:'TEST',uri:'https://example.test/metadata',additionalMetadata:[]}))
const benign=[tlv(ExtensionType.MetadataPointer,Buffer.concat([zero.toBuffer(),new PublicKey(mint).toBuffer()])),tlv(ExtensionType.TokenMetadata,metadata)]
function mintData(ext=benign,patch={}){const base=Buffer.alloc(82);MintLayout.encode({mintAuthorityOption:0,mintAuthority:zero,supply:1000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:zero,...patch},base);return Buffer.concat([base,Buffer.alloc(83),Buffer.from([1]),...ext])}
function accountData(ext=[tlv(ExtensionType.ImmutableOwner)],patch={}){const base=Buffer.alloc(165);AccountLayout.encode({mint:new PublicKey(mint),owner:new PublicKey(wallet),amount:100n,delegateOption:0,delegate:zero,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:zero,...patch},base);return Buffer.concat([base,Buffer.from([2]),...ext])}
const raw=(data:Buffer)=>({owner:program,executable:false,lamports:2000000,data:[data.toString('base64'),'base64']})
const row={pubkey:ata,account:{owner:program,data:{parsed:{type:'account',info:{owner:wallet,mint,state:'initialized',isNative:false,extensions:[{extension:'immutableOwner'}],tokenAmount:{amount:'100',decimals:6}}}}}}
const responses=[{context:{slot:100},value:[]},{context:{slot:101},value:[row]}]
function evidence(m=mintData(),a=accountData(),slot=102){return new Map([[mint,{slot,account:raw(m)}],[ata,{slot,account:raw(a)}]])}
const inspect=(e=evidence(),r=responses)=>inspectPositionResponses(wallet,r,now,e)

test('finalized raw metadata-only mint and immutable owner account permit inventory planning, not execution',()=>{
 const result=inspect();assert.equal(result.positions[0].tokenUnits,'100');assert.equal(result.positions[0].spendableTokenUnits,'100');assert.equal(result.costBasisVerified,false);assert.equal(result.source,'finalized-rpc-token-accounts')
 assert.deepEqual(result.contextSlots,[100,101]);assert.equal(result.executionEnabled,undefined)
})
test('dangerous and unknown mint/account extensions remain held with their real balances',()=>{
 for(const type of [ExtensionType.TransferFeeConfig,ExtensionType.TransferHook,ExtensionType.ConfidentialTransferMint,ExtensionType.NonTransferable,ExtensionType.PermanentDelegate,ExtensionType.PausableConfig,ExtensionType.DefaultAccountState,65535]){
  const result=inspect(evidence(mintData([...benign,tlv(type)])));assert.equal(result.positions[0].tokenUnits,'100');assert.equal(result.positions[0].spendableTokenUnits,'0')
 }
 for(const type of [ExtensionType.TransferFeeAmount,ExtensionType.TransferHookAccount,ExtensionType.CpiGuard,ExtensionType.MemoTransfer,ExtensionType.NonTransferableAccount,65535])assert.equal(inspect(evidence(mintData(),accountData([tlv(type)]))).positions[0].spendableTokenUnits,'0')
})
test('authorities, frozen/native/delegated accounts, inconsistent amounts and older evidence stay held',()=>{
 for(const patch of [{mintAuthorityOption:1,mintAuthority:new PublicKey(wallet)},{freezeAuthorityOption:1,freezeAuthority:new PublicKey(wallet)},{decimals:9},{supply:99n},{isInitialized:false}])assert.equal(inspect(evidence(mintData(benign,patch))).positions[0].spendableTokenUnits,'0')
 for(const patch of [{state:2},{state:3},{delegateOption:1,delegate:new PublicKey(wallet)},{isNativeOption:1},{delegatedAmount:1n},{closeAuthorityOption:1,closeAuthority:new PublicKey(wallet)},{amount:101n},{owner:new PublicKey(mint)}])assert.equal(inspect(evidence(mintData(),accountData(undefined,patch))).positions[0].spendableTokenUnits,'0')
 assert.equal(inspect(evidence(mintData(),accountData(),100)).positions[0].spendableTokenUnits,'0')
 assert.equal(inspect(new Map()).positions[0].spendableTokenUnits,'0')
 const contradictory=structuredClone(responses);contradictory[1].value[0].account.data.parsed.info.extensions=[{extension:'transferFeeAmount'}]
 assert.equal(inspect(evidence(),contradictory).positions[0].spendableTokenUnits,'0')
})
test('metadata identity, TLV duplicates/truncation and malformed variable data fail closed',()=>{
 const wrong=Buffer.from(pack({mint:new PublicKey(wallet),name:'Wrong',symbol:'X',uri:'',additionalMetadata:[]}))
 for(const ext of [[...benign,benign[0]], [benign[0]], [benign[1]], [benign[0],tlv(ExtensionType.TokenMetadata,wrong)], [benign[0],tlv(ExtensionType.TokenMetadata,Buffer.from([1,2,3]))], [...benign,Buffer.from([18,0,255,255])], [...benign,Buffer.from([1])]])assert.equal(inspect(evidence(mintData(ext))).positions[0].spendableTokenUnits,'0')
 const huge=Buffer.from(metadata);huge.writeUInt32LE(0xffffffff,64)
 assert.equal(inspect(evidence(mintData([benign[0],tlv(ExtensionType.TokenMetadata,huge)]))).positions[0].spendableTokenUnits,'0')
})
test('collector requests raw finalized mint+account evidence at a nonregressing slot; RPC failure preserves held balance',async()=>{
 const calls:any[]=[]
 const run=async(fail=false,slot=102)=>collectFinalizedPositions('https://rpc.example.test',wallet,async(_url:any,options:any)=>{
  const request=JSON.parse(options.body);calls.push(request)
  if(request.method==='getTokenAccountsByOwner')return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:responses[request.id-1]}))
  assert.equal(request.method,'getMultipleAccounts');assert.deepEqual(request.params[0],[ata,mint]);assert.equal(request.params[1].minContextSlot,101);assert.equal(request.params[1].commitment,'finalized');assert.equal(request.params[1].encoding,'base64')
  if(fail)return new Response('{}',{status:503})
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{context:{slot},value:[raw(accountData()),raw(mintData())]}}))
 })
 assert.equal((await run()).positions[0].spendableTokenUnits,'100');assert.equal(calls.length,3)
 const failed=await run(true);assert.equal(failed.positions[0].tokenUnits,'100');assert.equal(failed.positions[0].spendableTokenUnits,'0')
 assert.equal((await run(false,100)).positions[0].spendableTokenUnits,'0')
})
