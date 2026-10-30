import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { screen } from './strategy-policy.mjs';

// Market data for the strategy. DexScreener for market metrics, the RPC (Helius) for
// on-chain facts. Every fetch is bounded; a failed read yields null and screens out.
const require = createRequire(import.meta.url);
const { OnlinePumpSdk, bondingCurvePda } = require('@pump-fun/pump-sdk');
const { canonicalPumpPoolPda } = require('@pump-fun/pump-swap-sdk');
const DEX = 'https://api.dexscreener.com';
const getJson = async (url, fetchImpl = fetch) => {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  return r.json();
};

/** Recently profiled or boosted pump.fun coins, newest first. */
export async function candidates(limit, fetchImpl = fetch) {
  const lists = await Promise.allSettled([getJson(`${DEX}/token-profiles/latest/v1`, fetchImpl), getJson(`${DEX}/token-boosts/latest/v1`, fetchImpl)]);
  const mints = [];
  for (const l of lists) if (l.status === 'fulfilled' && Array.isArray(l.value))
    for (const t of l.value) if (t?.chainId === 'solana' && typeof t.tokenAddress === 'string' && t.tokenAddress.endsWith('pump') && !mints.includes(t.tokenAddress)) mints.push(t.tokenAddress);
  return mints.slice(0, limit);
}

/**
 * Active coins still on pump.fun's bonding curve. Profiles and boosts are mostly graduated or
 * dead coins, so the curve screen (user bots) adds DexScreener's pump.fun pair search.
 */
export async function curveCandidates(limit, fetchImpl = fetch) {
  let pairs = [];
  try { pairs = (await getJson(`${DEX}/latest/dex/search?q=pumpfun`, fetchImpl))?.pairs || []; } catch {}
  const mints = [];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const mint = p?.baseToken?.address;
    if (p?.chainId === 'solana' && p.dexId === 'pumpfun' && typeof mint === 'string' && mint.endsWith('pump') && !mints.includes(mint)) mints.push(mint);
  }
  return mints.slice(0, limit);
}

/** Best pump.fun / PumpSwap pair per mint, as plain metrics. */
export async function marketMetrics(mints, fetchImpl = fetch) {
  const out = new Map();
  for (let i = 0; i < mints.length; i += 30) {
    let pairs = [];
    try { pairs = await getJson(`${DEX}/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`, fetchImpl); } catch { continue; }
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const mint = p?.baseToken?.address;
      if (!mints.includes(mint) || !['pumpfun', 'pumpswap'].includes(p.dexId) || p.quoteToken?.symbol !== 'SOL') continue;
      const m = { chainId: p.chainId, mint, symbol: p.baseToken.symbol, dexId: p.dexId, pairAddress: p.pairAddress, image: p.info?.imageUrl ?? null,
        pairCreatedAt: p.pairCreatedAt, liquidityUsd: p.liquidity?.usd,
        marketCapUsd: p.marketCap ?? p.fdv, volume5mUsd: p.volume?.m5, volume24hUsd: p.volume?.h24,
        buys5m: p.txns?.m5?.buys, sells5m: p.txns?.m5?.sells, change5m: p.priceChange?.m5, change1h: p.priceChange?.h1, priceSol: Number(p.priceNative), solUsd: Number(p.priceUsd) / Number(p.priceNative) };
      const prev = out.get(mint);
      if (!prev || (m.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0)) out.set(mint, m);
    }
  }
  return out;
}

async function dasHolders(rpcUrl, mint, enough, fetchImpl) {
  const r = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccounts', params: { mint, limit: Math.min(1000, Math.max(1, enough)), options: { showZeroBalance: false } } }) });
  const body = await r.json();
  const n = body?.result?.token_accounts?.length;
  return Number.isSafeInteger(n) ? n : null; // a count of at least `enough`, capped there
}

/** Authorities, holder floor, top-10 share among wallet holders, creator share. */
async function chainFacts(conn, rpcUrl, mint, minHolders, fetchImpl = fetch) {
  const key = new PublicKey(mint), account = await conn.getAccountInfo(key, 'confirmed');
  if (!account || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())) return null;
  const info = await getMint(conn, key, 'confirmed', account.owner);
  const supply = Number(info.supply);
  if (!(supply > 0)) return null;
  const largest = (await conn.getTokenLargestAccounts(key, 'confirmed')).value;
  const parsed = await conn.getMultipleParsedAccounts(largest.map(a => a.address), { commitment: 'confirmed' });
  // Only this coin's own bonding curve and canonical PumpSwap pool hold liquidity, not
  // positions. Every other owner counts, including other program-owned accounts.
  const venues = new Set([bondingCurvePda(key).toBase58(), canonicalPumpPoolPda(key).toBase58()]);
  if (parsed.value.some(v => !v?.data?.parsed?.info?.owner)) return null;
  const holders = largest.map((a, i) => ({ amount: Number(a.amount), owner: parsed.value[i].data.parsed.info.owner })).filter(x => !venues.has(x.owner));
  const top10Share = holders.slice(0, 10).reduce((n, x) => n + x.amount, 0) / supply;
  // The creator's share across all of its token accounts for this mint; unknown fails closed.
  let devShare = null, curveSol = null;
  try {
    const curve = await new OnlinePumpSdk(conn).fetchBondingCurve(key), creator = curve.creator;
    // SOL the bonding curve holds: what a sell on the curve is paid from (curve screen only).
    const real = curve.realQuoteReserves ?? curve.realSolReserves; // renamed in newer pump-sdk
    if (!curve.complete && real) curveSol = Number(real.toString()) / 1e9;
    const accounts = await conn.getParsedTokenAccountsByOwner(creator, { mint: key }, 'confirmed');
    devShare = accounts.value.reduce((n, a) => n + Number(a.account.data.parsed.info.tokenAmount.amount), 0) / supply;
  } catch { devShare = null; }
  let holderCount = null;
  try { holderCount = await dasHolders(rpcUrl, mint, minHolders, fetchImpl); } catch { holderCount = null; }
  return { mintAuthority: info.mintAuthority ? info.mintAuthority.toBase58() : null, freezeAuthority: info.freezeAuthority ? info.freezeAuthority.toBase58() : null,
    decimals: info.decimals, top10Share, devShare, holders: holderCount, curveSol, tokenProgram: account.owner.toBase58() };
}

/** Candidates + held coins: market metrics for all, chain facts only where the market screen passes. */
export async function gatherMarket(c, conn, rpcUrl, heldMints, now) {
  const found = await candidates(c.scanLimit);
  if (c.curveScreen === true) for (const m of await curveCandidates(c.scanLimit)) if (!found.includes(m)) found.push(m);
  const metrics = await marketMetrics([...new Set([...found, ...heldMints])]);
  const facts = new Map();
  let screened = 0;
  for (const [mint, m] of metrics) {
    if (heldMints.includes(mint)) continue;
    // Only spend RPC calls on coins whose market metrics already pass.
    const pre = screen({ ...m, mintAuthority: null, freezeAuthority: null, holders: Number.MAX_SAFE_INTEGER, top10Share: 0, devShare: 0, curveSol: Number.MAX_SAFE_INTEGER }, c, now);
    if (!pre.ok) continue;
    screened++;
    try { const f = await chainFacts(conn, rpcUrl, mint, c.minHolders); if (f) facts.set(mint, f); } catch {}
  }
  return { metrics, facts, scanned: found.length, preScreened: screened };
}
