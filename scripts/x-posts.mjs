// Posts Grok Bot's real trades to X, exactly once each. Paper trades never post.
// Credentials are an X developer app's OAuth 1.0a user keys in a private file; they never leave
// this process and are never logged.
import { createHmac, randomBytes } from 'node:crypto';

export const DEFAULT_X = { xPostsEnabled: false, maxPerDay: 15, site: 'https://grokgrid-alpha.vercel.app' };
const TWEETS = 'https://api.x.com/2/tweets';

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a header for a JSON POST (the JSON body is not part of the signature). */
export function oauthHeader(method, url, creds, nonce = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000)) {
  const p = { oauth_consumer_key: creds.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(ts), oauth_token: creds.accessToken, oauth_version: '1.0' };
  const params = Object.keys(p).sort().map(k => `${enc(k)}=${enc(p[k])}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(params)].join('&');
  const sig = createHmac('sha1', `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...p, oauth_signature: sig }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ');
}

export function validCreds(c) {
  return !!c && ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'].every(k => typeof c[k] === 'string' && c[k].length >= 8 && c[k].length <= 200);
}

/** Real, reconciled house trades not yet posted, oldest first. */
export function pendingPosts(state, ledger) {
  const done = new Set(Object.keys(ledger.posted || {}));
  return (state?.intents || []).filter(i => i.state === 'reconciled-confirmed' && i.signature && i.receipt && !done.has(i.signature));
}

export function postText(i, symbol, site = DEFAULT_X.site) {
  const lamports = i.side === 'buy' ? i.receipt.spentLamports : i.receipt.receivedLamports;
  const sol = (Number(BigInt(lamports)) / 1e9).toFixed(3);
  const coin = symbol ? `$${String(symbol).replace(/[^A-Za-z0-9_]/g, '').slice(0, 15)}` : 'a coin';
  return [
    `${i.side === 'buy' ? 'bought' : 'sold'} ${coin} for ${sol} SOL`,
    `pump.fun/coin/${i.mint}`,
    `tx: solscan.io/tx/${i.signature}`,
    `watch me trade: ${site.replace(/^https:\/\//, '')}`,
  ].join('\n').slice(0, 280);
}

/** Daily cap counted over the last 24h of successful posts. */
export function postGate(ledger, cfg, now) {
  if (!cfg.xPostsEnabled) return 'disabled';
  const recent = Object.values(ledger.posted || {}).filter(p => p.outcome === 'posted' && now - p.at < 86_400_000).length;
  return recent >= cfg.maxPerDay ? 'daily-cap' : 'ok';
}

export async function sendPost(text, creds, fetchImpl = fetch) {
  const r = await fetchImpl(TWEETS, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { authorization: oauthHeader('POST', TWEETS, creds), 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  let id = null; try { id = (await r.json())?.data?.id ?? null; } catch {}
  return { status: r.status, id };
}
