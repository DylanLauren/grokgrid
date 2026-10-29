// Posts Grok Bot's real trades to X, exactly once each. Paper trades never post.
// Credentials are an X developer app's OAuth 1.0a user keys in a private file; they never leave
// this process and are never logged.
import { createHmac, randomBytes } from 'node:crypto';

export const DEFAULT_X = { xPostsEnabled: false, maxPerDay: 15, site: 'https://www.grokgrid.fun' };
const TWEETS = 'https://api.x.com/2/tweets';

const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * OAuth 1.0a header. JSON and multipart bodies are not signed; query parameters are, so a
 * URL with a query string is signed over its base URL plus those parameters.
 */
export function oauthHeader(method, url, creds, nonce = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000)) {
  const u = new URL(url), query = Object.fromEntries(u.searchParams);
  url = `${u.origin}${u.pathname}`;
  const p = { oauth_consumer_key: creds.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(ts), oauth_token: creds.accessToken, oauth_version: '1.0' };
  const all = { ...query, ...p };
  const params = Object.keys(all).sort().map(k => `${enc(k)}=${enc(all[k])}`).join('&');
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

export async function sendPost(text, creds, fetchImpl = fetch, mediaIds = []) {
  const body = mediaIds.length ? { text, media: { media_ids: mediaIds } } : { text };
  const r = await fetchImpl(TWEETS, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { authorization: oauthHeader('POST', TWEETS, creds), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let id = null; try { id = (await r.json())?.data?.id ?? null; } catch {}
  return { status: r.status, id };
}

const UPLOAD = 'https://api.x.com/2/media/upload';
const CHUNK = 4 * 1024 * 1024;

/**
 * X API v2 chunked upload (initialize, append, finalize, then status while processing).
 * Returns the media id, or null on any failure so the caller posts text only.
 */
export async function uploadMedia(bytes, mediaType, creds, fetchImpl = fetch, { sleep = ms => new Promise(r => setTimeout(r, ms)), maxPolls = 30 } = {}) {
  try {
    const category = mediaType.startsWith('video/') ? 'tweet_video' : 'tweet_image';
    const call = async (method, url, init = {}) => {
      const r = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(60_000), ...init, headers: { authorization: oauthHeader(method, url, creds), ...(init.headers || {}) } });
      if (!r.ok) throw Error(`upload ${r.status}`);
      return r.status === 204 ? {} : r.json().catch(() => ({}));
    };
    const init = await call('POST', `${UPLOAD}/initialize`, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ media_type: mediaType, total_bytes: bytes.length, media_category: category }) });
    const id = init?.data?.id;
    if (typeof id !== 'string' || !/^\d{1,32}$/.test(id)) return null;
    for (let i = 0, off = 0; off < bytes.length; i++, off += CHUNK) {
      const form = new FormData();
      form.append('segment_index', String(i));
      form.append('media', new Blob([bytes.subarray(off, off + CHUNK)], { type: 'application/octet-stream' }), 'chunk');
      await call('POST', `${UPLOAD}/${id}/append`, { body: form });
    }
    let info = (await call('POST', `${UPLOAD}/${id}/finalize`))?.data?.processing_info;
    for (let n = 0; info && n < maxPolls; n++) {
      if (info.state === 'succeeded') break;
      if (info.state === 'failed') return null;
      await sleep(Math.min(30, Math.max(1, Number(info.check_after_secs) || 2)) * 1000);
      info = (await call('GET', `${UPLOAD}?command=STATUS&media_id=${id}`))?.data?.processing_info;
    }
    return !info || info.state === 'succeeded' ? id : null;
  } catch { return null; }
}
