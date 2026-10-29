// pump.fun Callouts for the house profile ("GrokGrid", the house wallet). A callout
// push-notifies followers and counts on pump.fun's caller leaderboard. Every coin the house
// buys gets called while it still holds it; pump.fun's own eligibility check is the only limit.
//
// Route: the house's logged-in pump.fun session in Chrome. AppleScript runs a script in an
// existing pump.fun tab, so requests are same-origin with that session; the cookie/JWT
// never leaves Chrome and the script returns only a status/verdict string. It first calls
// GET /callout/eligibility/{mint} (what the page itself calls) and only then, outside a
// dry run, POST /callout/create (multipart: coinMint, thesis).
// Off unless pumpCalloutsEnabled. Real trades only: paper fills never reach this.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { whyText } from './trade-why.mjs';

const run = promisify(execFile);
const DAY = 24 * 3600000, RETRY_MS = 10 * 60000;
const API = 'https://frontend-api-v3.pump.fun';

export const DEFAULT_CALLOUTS = Object.freeze({ pumpCalloutsEnabled: false, tabUrlPrefix: 'https://pump.fun/' });

const posted = (ledger, i, now) => (ledger?.calls || []).some(c => c.outcome === 'posted' && (c.signature === i.signature || (c.mint === i.mint && now - c.at < DAY)));

/** The coin to call: the newest reconciled real buy the house still holds and hasn't called. */
export function pickCallout(tradingState, positions, ledger = { calls: [] }, now = Date.now()) {
  const held = new Set((positions?.positions || []).filter(p => BigInt(p.tokenUnits) > 0n).map(p => p.mint));
  const buys = tradingState.intents.filter(i => i.state === 'reconciled-confirmed' && i.side === 'buy' && held.has(i.mint) && !posted(ledger, i, now))
    .sort((a, b) => b.createdAt - a.createdAt);
  return buys[0] || null;
}

/** Why not to call now, or 'ok'. Pure. A failed attempt on a buy is retried after ten minutes. */
export function calloutGate(ledger, cfg, intent, now) {
  if (!cfg.pumpCalloutsEnabled) return 'disabled';
  if (!intent) return 'nothing-held';
  if (posted(ledger, intent, now)) return 'already-called';
  if ((ledger.calls || []).some(c => c.signature === intent.signature && now - c.at < RETRY_MS)) return 'retry-later';
  return 'ok';
}

/** `why` is the strategy's recorded reason (trade-why.mjs); without one the generic screen line stands. */
export function thesis(intent, symbol, why = null) {
  const sol = (Number(BigInt(intent.receipt.spentLamports)) / 1e9).toFixed(3);
  const coin = symbol ? '$' + String(symbol).replace(/[^\w]/g, '').slice(0, 12) : 'this';
  const reason = whyText(why, coin)?.replace(/^bought [^:]+: /, '');
  const because = reason ? `Why: ${reason}` : 'Screened for liquidity, rising buyers and holder spread.';
  return `Grok Bot bought ${sol} SOL of ${coin} on its own. ${because} Live at grokgrid.fun. Not financial advice.`.slice(0, 280);
}

// Page script. Arguments are JSON-encoded; only a short result string is written back.
export function pageScript(mint, text, dryRun) {
  return `(async()=>{const put=v=>{document.documentElement.dataset.ggCallout=String(v).slice(0,60)};try{` +
    `const e=await fetch(${JSON.stringify(`${API}/callout/eligibility/${mint}`)},{credentials:'include'});` +
    `if(!e.ok)return put('eligibility-http-'+e.status);const b=await e.json();const v=b&&b.preflight&&b.preflight.create&&b.preflight.create.verdict;` +
    `if(!b||b.eligible!==true||(v&&v!=='OK'&&v!=='ELIGIBLE'&&v!=='ALLOWED'))return put('verdict-'+(v||'ineligible'));` +
    (dryRun ? `return put('dry-run-eligible-'+(v||'unknown'));` :
      `const f=new FormData();f.append('coinMint',${JSON.stringify(mint)});f.append('thesis',${JSON.stringify(text)});` +
      `const r=await fetch(${JSON.stringify(`${API}/callout/create`)},{method:'POST',credentials:'include',body:f});put('create-http-'+r.status);`) +
    `}catch(x){put('error')}})();'started'`;
}

const appleString = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** Runs in the first pump.fun tab. Returns the result string ('no-tab', 'apple-events-off', ...). */
export async function runCallout(cfg, mint, text, dryRun, exec = run) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return 'invalid-mint';
  const script = `tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t starts with ${appleString(cfg.tabUrlPrefix)} then
        tell t to execute javascript "delete document.documentElement.dataset.ggCallout"
        tell t to execute javascript ${appleString(pageScript(mint, text, dryRun))}
        repeat 20 times
          delay 0.5
          tell t to set r to (execute javascript "document.documentElement.dataset.ggCallout || ''")
          if r is not "" then return r
        end repeat
        return "timeout"
      end if
    end repeat
  end repeat
  return "no-tab"
end tell`;
  try { return (await exec('osascript', ['-e', script], { timeout: 30000 })).stdout.trim().slice(0, 60); }
  catch (e) { return /JavaScript through AppleScript is turned off/.test(String(e?.stderr || e)) ? 'apple-events-off' : 'osascript-error'; }
}
