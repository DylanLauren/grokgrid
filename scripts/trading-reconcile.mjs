// Read-only Solana receipt adapter. Never builds, signs or sends a transaction.
import { publicAddress } from './trading-policy.mjs';
const WSOL = 'So11111111111111111111111111111111111111112';
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
const safeNatural = x => Number.isSafeInteger(x) && x >= 0;
const signatureValid = x => typeof x === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(x);

// Requires matching independent status + transaction responses requested at
// finalized commitment. Balance movements prove neither strategy nor cost basis.
export function inspectFinalizedIntentReceipt(intent, status, tx) {
  try {
    if (!signatureValid(intent?.signature) || !publicAddress(intent.wallet) || !publicAddress(intent.mint) || intent.mint === WSOL || !['buy','sell'].includes(intent.side) || (intent.side === 'buy' ? !integer(intent.spendLamports) || BigInt(intent.spendLamports) <= 0n : !integer(intent.tokenUnits) || BigInt(intent.tokenUnits) <= 0n || !integer(intent.minimumReceiveLamports) || BigInt(intent.minimumReceiveLamports) <= 0n || !Number.isInteger(intent.tokenDecimals) || intent.tokenDecimals < 0 || intent.tokenDecimals > 18) || !safeNatural(intent.createdAt) || !safeNatural(intent.expiresAt) || intent.expiresAt <= intent.createdAt) return null;
    if (!status || status.confirmationStatus !== 'finalized' || !safeNatural(status.slot) || tx?.slot !== status.slot || !tx.meta || !safeNatural(tx.blockTime) || tx.blockTime === 0) return null;
    // Block time has second precision. Only receipts from the original intent's
    // validity interval can reconcile it; an unrelated old trade cannot be reused.
    if (tx.blockTime * 1000 + 999 < intent.createdAt || tx.blockTime * 1000 > intent.expiresAt) return null;
    if (!Array.isArray(tx.transaction?.signatures) || tx.transaction.signatures[0] !== intent.signature) return null;
    const keys = tx.transaction.message?.accountKeys;
    if (!Array.isArray(keys) || keys.some(k => !publicAddress(k?.pubkey))) return null;
    if (new Set(keys.map(k => k.pubkey)).size !== keys.length) return null;
    const walletIndex = keys.findIndex(k => k.pubkey === intent.wallet && k.signer === true);
    if (walletIndex < 0) return null;
    const { meta } = tx, pre = meta.preTokenBalances, post = meta.postTokenBalances;
    if (!Array.isArray(pre) || !Array.isArray(post)) return null;
    if (!keys.some(k => k.pubkey === intent.mint) && ![...pre,...post].some(b => b?.mint === intent.mint && b.owner === intent.wallet)) return null;
    if (status.err === undefined || meta.err === undefined || JSON.stringify(status.err) !== JSON.stringify(meta.err)) return null;
    const base = { signature:intent.signature, wallet:intent.wallet, mint:intent.mint, finality:'finalized', slot:tx.slot };
    // A finalized failed transaction changed no trade balances. It may still
    // charge a network fee; this worker does not claim loss accounting is done.
    if (meta.err !== null) return {...base,outcome:'failed'};
    const all = [...pre,...post];
    for (const list of [pre,post]) {
      const indices = new Set();
      for (const b of list) {
        if (!safeNatural(b?.accountIndex) || b.accountIndex >= keys.length || indices.has(b.accountIndex) || !publicAddress(b.mint) || !publicAddress(b.owner) || !integer(b.uiTokenAmount?.amount) || !Number.isInteger(b.uiTokenAmount.decimals) || b.uiTokenAmount.decimals < 0 || b.uiTokenAmount.decimals > 18) return null;
        indices.add(b.accountIndex);
      }
    }
    // Ownership/mint mutation needs separate analysis; don't attribute lamports
    // from an account belonging to someone else after the transaction.
    for (const b of pre) {
      const a = post.find(x => x.accountIndex === b.accountIndex);
      if (a && (a.owner !== b.owner || a.mint !== b.mint || a.uiTokenAmount.decimals !== b.uiTokenAmount.decimals)) return null;
    }
    const own = all.filter(b => b.owner === intent.wallet);
    const target = own.filter(b => b.mint === intent.mint);
    if (!target.length || intent.side === 'sell' && target[0].uiTokenAmount.decimals !== intent.tokenDecimals || target.some(b => b.uiTokenAmount.decimals !== target[0].uiTokenAmount.decimals)) return null;
    const sum = (rows,mint) => rows.filter(b => b.owner === intent.wallet && b.mint === mint).reduce((n,b)=>n+BigInt(b.uiTokenAmount.amount),0n);
    const received = sum(post,intent.mint)-sum(pre,intent.mint);
    if (intent.side === 'buy' ? received <= 0n : received >= 0n || -received !== BigInt(intent.tokenUnits)) return null;
    for (const mint of new Set(own.map(b=>b.mint))) if (mint !== intent.mint && mint !== WSOL && sum(post,mint) !== sum(pre,mint)) return null;
    if (!Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) || meta.preBalances.length !== keys.length || meta.postBalances.length !== keys.length) return null;
    let net = 0n;
    for (const index of new Set([walletIndex,...own.map(b=>b.accountIndex)])) {
      if (!safeNatural(meta.preBalances[index]) || !safeNatural(meta.postBalances[index])) return null;
      net += BigInt(meta.postBalances[index])-BigInt(meta.preBalances[index]);
    }
    if (!safeNatural(meta.fee)) return null;
    if (walletIndex === 0) net += BigInt(meta.fee);
    if (intent.side === 'buy') {
      // An executed buy is exact-out with a SOL ceiling: it may spend less, never more.
      const ceiling = integer(intent.maxCostLamports) ? BigInt(intent.maxCostLamports) : null;
      if (net >= 0n || (ceiling === null ? -net !== BigInt(intent.spendLamports) : -net > ceiling)) return null;
      return {...base,outcome:'confirmed',spentLamports:(-net).toString(),receivedTokenUnits:received.toString()};
    }
    if (net <= 0n || net < BigInt(intent.minimumReceiveLamports)) return null;
    return {...base,outcome:'confirmed',soldTokenUnits:(-received).toString(),receivedLamports:net.toString()};
  } catch { return null; }
}

export function createFinalizedReceiptVerifier(rpcUrl, fetchImpl = globalThis.fetch) {
  let endpoint;
  try { endpoint = new URL(rpcUrl); if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw Error(); }
  catch { throw Error('Invalid read-only receipt provider configuration'); }
  async function rpc(method,params,id) {
    const response = await fetchImpl(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(8000),redirect:'error'});
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.jsonrpc !== '2.0' || body.id !== id || body.error) return null;
    return body.result ?? null;
  }
  return async intent => {
    try {
      if (!signatureValid(intent?.signature)) return null;
      const statuses = await rpc('getSignatureStatuses',[[intent.signature],{searchTransactionHistory:true}],1);
      const status = statuses?.value?.[0];
      if (status?.confirmationStatus !== 'finalized') return null;
      const tx = await rpc('getTransaction',[intent.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}],2);
      return inspectFinalizedIntentReceipt(intent,status,tx);
    } catch { return null; } // Never expose provider URLs, query keys or raw errors.
  };
}
