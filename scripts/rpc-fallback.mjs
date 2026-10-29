// One RPC endpoint is a single point of failure. A request that fails on the primary (network
// error, timeout, 429 or 5xx) is retried once on a fallback endpoint. Same request body, so
// reads and sends behave identically; JSON-RPC errors in a 200 response are not retried.
export const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

/** The fallback URL: GROKGRID_RPC_FALLBACK if set (https only), else Solana's public RPC. */
export function fallbackUrl(env = process.env) {
  const v = env.GROKGRID_RPC_FALLBACK;
  try { if (v && new URL(v).protocol === 'https:') return v; } catch {}
  return PUBLIC_RPC;
}

const retryable = r => r.status === 429 || r.status >= 500;

/** fetch for @solana/web3.js: primary first, then the fallback once. */
export function fallbackFetch(primary, fallback, fetchImpl = fetch, timeoutMs = 15000) {
  const once = (url, init) => fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  return async (url, init) => {
    try {
      const r = await once(url, init);
      if (!retryable(r) || !fallback || fallback === primary) return r;
    } catch (e) { if (!fallback || fallback === primary) throw e; }
    return once(fallback, init);
  };
}
