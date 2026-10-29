// Actual finalized token-account balances only; no price, cost basis or PnL.
import { PublicKey } from '@solana/web3.js';
import { unpackMint, unpackAccount, MintLayout, AccountLayout, ExtensionType, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { unpack as unpackMetadata, pack as packMetadata } from '@solana/spl-token-metadata';
import { publicAddress } from './trading-policy.mjs';
const PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
// Decode every TLV, including unknown IDs. The SDK's extension enumeration alone
// does not reject truncated bodies, duplicate extensions or trailing junk.
function extensions(data) {
  const result=new Map();let offset=0;
  while(offset<data.length){
    if(data.subarray(offset).every(byte=>byte===0))break;
    if(data.length-offset<4)throw Error('extension-truncated');
    const type=data.readUInt16LE(offset),length=data.readUInt16LE(offset+2);offset+=4;
    if(type===0||result.has(type)||offset+length>data.length)throw Error('extension-invalid');
    result.set(type,data.subarray(offset,offset+length));offset+=length;
  }
  return result;
}
function rawInfo(value) {
  if(!value||value.owner!==PROGRAMS[1]||value.executable!==false||!Array.isArray(value.data)||value.data[1]!=='base64'||typeof value.data[0]!=='string'||value.data[0].length>131072)throw Error('raw-account-invalid');
  const data=Buffer.from(value.data[0],'base64');
  if(data.toString('base64')!==value.data[0])throw Error('raw-account-invalid');
  return {...value,data,owner:TOKEN_2022_PROGRAM_ID};
}
function metadataMatches(data,mint) {
  // Bound each variable field before using the pinned metadata codec.
  let offset=64;
  const string=()=>{if(offset+4>data.length)throw Error('metadata-invalid');const n=data.readUInt32LE(offset);offset+=4;if(n>data.length-offset)throw Error('metadata-invalid');offset+=n;};
  for(let n=0;n<3;n++)string();
  if(offset+4>data.length)return false;const count=data.readUInt32LE(offset);offset+=4;
  if(count>Math.floor((data.length-offset)/8))return false;
  for(let n=0;n<count;n++){string();string();}
  if(offset!==data.length)return false;
  const decoded=unpackMetadata(data);
  return decoded.mint.toBase58()===mint&&Buffer.from(packMetadata(decoded)).equals(data);
}
export function token2022PositionEligible(wallet,row,evidence,minimumSlot) {
  try{
    const info=row.account.data.parsed.info;
    if(info.extensions!==undefined&&(!Array.isArray(info.extensions)||info.extensions.some(e=>!e||e.extension!=='immutableOwner')||info.extensions.length>1))return false;
    const mintProof=evidence?.get(info.mint),accountProof=evidence?.get(row.pubkey);
    if(![mintProof,accountProof].every(p=>p&&Number.isSafeInteger(p.slot)&&p.slot>=minimumSlot))return false;
    const mintRaw=rawInfo(mintProof.account),accountRaw=rawInfo(accountProof.account);
    if(mintRaw.data.length>82&&!mintRaw.data.subarray(82,165).every(byte=>byte===0))return false;
    const mintBase=MintLayout.decode(mintRaw.data),accountBase=AccountLayout.decode(accountRaw.data);
    if(mintBase.mintAuthorityOption!==0||mintBase.freezeAuthorityOption!==0||mintRaw.data[45]!==1||accountBase.delegateOption!==0||accountBase.isNativeOption!==0||accountBase.closeAuthorityOption!==0||accountBase.state!==1||accountBase.delegatedAmount!==0n)return false;
    const mint=unpackMint(new PublicKey(info.mint),mintRaw,TOKEN_2022_PROGRAM_ID);
    const account=unpackAccount(new PublicKey(row.pubkey),accountRaw,TOKEN_2022_PROGRAM_ID);
    if(!mint.isInitialized||mint.decimals!==info.tokenAmount.decimals||!account.isInitialized||account.isFrozen||account.isNative||account.delegate||account.owner.toBase58()!==wallet||account.mint.toBase58()!==info.mint||account.amount.toString()!==info.tokenAmount.amount||account.amount>mint.supply)return false;
    const mintExtensions=extensions(mint.tlvData),accountExtensions=extensions(account.tlvData);
    for(const [type,data] of mintExtensions){
      if(type===ExtensionType.MetadataPointer){
        if(data.length!==64||new PublicKey(data.subarray(32)).toBase58()!==info.mint)return false;
      }else if(type===ExtensionType.TokenMetadata){if(!metadataMatches(data,info.mint))return false;}
      else return false;
    }
    // A self-pointer must resolve to validated in-mint metadata, and vice versa.
    if(mintExtensions.has(ExtensionType.MetadataPointer)!==mintExtensions.has(ExtensionType.TokenMetadata))return false;
    for(const [type,data] of accountExtensions)if(type!==ExtensionType.ImmutableOwner||data.length!==0)return false;
    return true;
  }catch{return false;}
}
export function inspectPositionResponses(wallet, responses, observedAt = Date.now(), mintEvidence = null) {
  try {
    if (!publicAddress(wallet) || !Array.isArray(responses) || responses.length !== 2 || !Number.isSafeInteger(observedAt) || observedAt <= 0) return null;
    const accounts = new Set(), totals = new Map(), slots=[];
    for (let index=0;index<2;index++) {
      const response=responses[index];
      if (!Number.isSafeInteger(response?.context?.slot) || response.context.slot < 1 || !Array.isArray(response.value)) return null;
      slots.push(response.context.slot);
      for (const row of response.value) {
        const info=row?.account?.data?.parsed?.info;
        if (!publicAddress(row?.pubkey) || accounts.has(row.pubkey) || row.account.owner!==PROGRAMS[index] || row.account.data.parsed.type!=='account' || info?.owner!==wallet || !publicAddress(info.mint) || !integer(info.tokenAmount?.amount) || BigInt(info.tokenAmount.amount)>18446744073709551615n || !Number.isInteger(info.tokenAmount.decimals) || info.tokenAmount.decimals<0 || info.tokenAmount.decimals>18) return null;
        accounts.add(row.pubkey);
        const prior=totals.get(info.mint) ?? {mint:info.mint,tokenUnits:0n,spendableTokenUnits:0n,decimals:info.tokenAmount.decimals,tokenProgram:PROGRAMS[index]};
        if(prior.decimals!==info.tokenAmount.decimals || prior.tokenProgram!==PROGRAMS[index])return null;
        const amount=BigInt(info.tokenAmount.amount);prior.tokenUnits+=amount;
        // Eligibility is inventory evidence only, never permission to execute.
        const plainAccount=info.state==='initialized'&&info.isNative===false&&!info.delegate;
        const spendable=plainAccount&&(index===0
          ? (!info.extensions||Array.isArray(info.extensions)&&info.extensions.length===0)
          : token2022PositionEligible(wallet,row,mintEvidence,Math.max(...responses.map(r=>r.context.slot))));
        if(spendable)prior.spendableTokenUnits+=amount;
        totals.set(info.mint,prior);
      }
    }
    return {wallet,source:'finalized-rpc-token-accounts',commitment:'finalized',complete:true,observedAt,contextSlots:slots,positions:[...totals.values()].map(p=>({...p,tokenUnits:p.tokenUnits.toString(),spendableTokenUnits:p.spendableTokenUnits.toString()})),costBasisVerified:false};
  }catch{return null;}
}
export async function collectFinalizedPositions(rpcUrl,wallet,fetchImpl=globalThis.fetch) {
  try {
    const endpoint=new URL(rpcUrl);if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || !publicAddress(wallet))return null;
    const observedAt=Date.now();
    const responses=[];
    for(let index=0;index<PROGRAMS.length;index++) {
      const r=await fetchImpl(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:index+1,method:'getTokenAccountsByOwner',params:[wallet,{programId:PROGRAMS[index]},{encoding:'jsonParsed',commitment:'finalized'}]}),signal:AbortSignal.timeout(8000),redirect:'error'});
      if(!r.ok)return null;const body=await r.json();if(body?.jsonrpc!=='2.0'||body.id!==index+1||body.error)return null;responses.push(body.result);
    }
    const evidence=new Map();
    const minimumSlot=Math.max(...responses.map(r=>r?.context?.slot??0));
    if(!inspectPositionResponses(wallet,responses))return null;
    const addresses=[...new Set(responses[1].value.flatMap(row=>[row.pubkey,row.account.data.parsed.info.mint]))];
    // Keep a cycle bounded. Uninspected Token-2022 balances stay held, not zeroed.
    if(addresses.length<=2000)for(let offset=0;offset<addresses.length;offset+=100){
      const keys=addresses.slice(offset,offset+100),id=3+offset/100;
      try{
        const r=await fetchImpl(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:'getMultipleAccounts',params:[keys,{encoding:'base64',commitment:'finalized',minContextSlot:minimumSlot}]}),signal:AbortSignal.timeout(8000),redirect:'error'});
        if(!r.ok)continue;const body=await r.json(),result=body?.result;
        if(body?.jsonrpc!=='2.0'||body.id!==id||body.error||!Number.isSafeInteger(result?.context?.slot)||result.context.slot<minimumSlot||!Array.isArray(result.value)||result.value.length!==keys.length)continue;
        keys.forEach((key,index)=>evidence.set(key,{slot:result.context.slot,account:result.value[index]}));
      }catch{/* Preserve observed balances; absent evidence cannot permit planning. */}
    }
    return inspectPositionResponses(wallet,responses,observedAt,evidence);
  }catch{return null;}
}
