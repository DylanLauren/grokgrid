// Actual finalized token-account balances only; no price, cost basis or PnL.
import { publicAddress } from './trading-policy.mjs';
const PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
export function inspectPositionResponses(wallet, responses, observedAt = Date.now()) {
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
        // Frozen, delegated, native, or extension-bearing accounts need separate
        // transfer-rule review. Token-2022 mint extensions are not inspected here,
        // so all Token-2022 balances remain unspendable. Record them honestly.
        const spendable=index===0 && info.state==='initialized' && info.isNative===false && !info.delegate && (!info.extensions || Array.isArray(info.extensions)&&info.extensions.length===0);
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
    const responses=[];
    for(let index=0;index<PROGRAMS.length;index++) {
      const r=await fetchImpl(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:index+1,method:'getTokenAccountsByOwner',params:[wallet,{programId:PROGRAMS[index]},{encoding:'jsonParsed',commitment:'finalized'}]}),signal:AbortSignal.timeout(8000),redirect:'error'});
      if(!r.ok)return null;const body=await r.json();if(body?.jsonrpc!=='2.0'||body.id!==index+1||body.error)return null;responses.push(body.result);
    }
    return inspectPositionResponses(wallet,responses);
  }catch{return null;}
}
