import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(x);
const WSOL = 'So11111111111111111111111111111111111111112';
const positive = x => integer(x) && BigInt(x) > 0n;
const validAmounts = (i,p) => i.side === 'buy' ? positive(i.spendLamports) && BigInt(i.spendLamports) <= BigInt(p.maxTradeLamports) && i.tokenUnits === undefined && i.minimumReceiveLamports === undefined : i.side === 'sell' && positive(i.tokenUnits) && positive(i.minimumReceiveLamports) && Number.isInteger(i.tokenDecimals) && i.tokenDecimals >= 0 && i.tokenDecimals <= 18 && i.spendLamports === undefined;
// An executed buy carries maxCostLamports (budget + token-account rent); the actual spend may be lower.
const buyCostOk = (i,r) => positive(r.spentLamports) && (i.maxCostLamports === undefined ? r.spentLamports === i.spendLamports : BigInt(r.spentLamports) <= BigInt(i.maxCostLamports));
const receiptAmounts = (i,r) => i.side === 'buy' ? buyCostOk(i,r) && positive(r.receivedTokenUnits) : r.soldTokenUnits === i.tokenUnits && positive(r.receivedLamports) && BigInt(r.receivedLamports) >= BigInt(i.minimumReceiveLamports);
const timestamp = x => Number.isSafeInteger(x) && x > 0;
const PENDING = ['blocked-execution-disabled', 'planned', 'held-ambiguous'];
// 'dynamic' replaces a static list with the journal's expiring, filter-approved allowlist.
// Buys need a live entry; sells of a held position never do, so exits always work.
const dynamic = p => p.allowedMints === 'dynamic';
const mintPermitted = (p, mint) => dynamic(p) ? publicAddress(mint) : p.allowedMints.includes(mint);
const allowlisted = (s, mint, now) => (s.allowlist || []).some(a => a.mint === mint && a.expiresAt > now);
/** Replaces the allowlist (pruned of expired entries). */
export function setAllowlist(s, p, entries, now) {
  validateTradingState(s, p);
  if (!dynamic(p)) throw Error('Static allowlist policy');
  const next = entries.filter(a => a.expiresAt > now).map(a => ({ mint: a.mint, approvedAt: a.approvedAt, expiresAt: a.expiresAt }));
  if (JSON.stringify(next) === JSON.stringify(s.allowlist || [])) return s;
  return validateTradingState({ ...s, revision: s.revision + 1, allowlist: next }, p);
}
// Token-account rent a first buy may pay on top of its budget.
export const MAX_RENT_ALLOWANCE = 2_100_000n;
export function publicAddress(x) { try { return typeof x === 'string' && new PublicKey(x).toBase58() === x; } catch { return false; } }
const absolute = x => typeof x === 'string' && x.startsWith('/');
// 'observe-only' never signs. 'execute' is an explicit operator choice: both flags on, a stop file and a key file.
export const executes = p => p.mode === 'execute';
export function validateTradingPolicy(p) {
  const observe = p?.mode === 'observe-only' && p.executionEnabled === false && p.signingEnabled === false;
  const execute = p?.mode === 'execute' && p.executionEnabled === true && p.signingEnabled === true && absolute(p.stopFile) && absolute(p.keypairFile);
  if (!p || p.version !== 1 || !(observe || execute)) throw Error('Execution is disabled in this worker');
  if (!id(p.agentId) || !publicAddress(p.wallet) || !(p.allowedMints === 'dynamic' || (Array.isArray(p.allowedMints) && p.allowedMints.every(publicAddress) && new Set(p.allowedMints).size === p.allowedMints.length))) throw Error('Invalid pinned identities');
  for (const field of ['maxTradeLamports', 'maxExposureLamports', 'maxDailyLossLamports', 'reserveLamports']) if (!integer(p[field])) throw Error('Invalid integer policy');
  if (BigInt(p.maxTradeLamports) <= 0n || BigInt(p.maxExposureLamports) < BigInt(p.maxTradeLamports) || BigInt(p.maxDailyLossLamports) <= 0n) throw Error('Invalid limits');
  if (!Number.isSafeInteger(p.maxSlippageBps) || p.maxSlippageBps < 0 || p.maxSlippageBps > 2000 || !Number.isSafeInteger(p.maxPendingIntents) || p.maxPendingIntents < 1 || p.maxPendingIntents > 100 || !Number.isSafeInteger(p.maxIntentAgeMs) || p.maxIntentAgeMs < 1000 || p.maxIntentAgeMs > 3600000) throw Error('Invalid timing or execution limits');
  return p;
}
export function policyFingerprint(p) {
  validateTradingPolicy(p);
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(p).sort().map(k => [k, p[k]])))).digest('hex');
}
export function emptyTradingState(p) {
  return { version: 1, revision: 0, policyFingerprint: policyFingerprint(p), agentId: p.agentId, wallet: p.wallet, executionEnabled: p.executionEnabled, signingEnabled: p.signingEnabled, intents: [] };
}
export function validateTradingState(s, p) {
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || s.policyFingerprint !== policyFingerprint(p) || s.agentId !== p.agentId || s.wallet !== p.wallet || s.executionEnabled !== p.executionEnabled || s.signingEnabled !== p.signingEnabled || !Array.isArray(s.intents)) throw Error('Journal identity or policy mismatch');
  const ids = new Set(), signatures = new Set();
  for (const i of s.intents) {
    if (!id(i.id) || ids.has(i.id) || i.agentId !== p.agentId || i.wallet !== p.wallet || !mintPermitted(p, i.mint) || !validAmounts(i,p) || i.mint === WSOL || !Number.isSafeInteger(i.slippageBps) || i.slippageBps < 0 || i.slippageBps > p.maxSlippageBps || !timestamp(i.createdAt) || !timestamp(i.expiresAt) || i.expiresAt <= i.createdAt || i.expiresAt - i.createdAt > p.maxIntentAgeMs || ![...PENDING, 'expired', 'dropped-expired', 'reconciled-failed', 'reconciled-confirmed'].includes(i.state) || (i.maxCostLamports !== undefined && (i.side !== 'buy' || !integer(i.maxCostLamports) || BigInt(i.maxCostLamports) < BigInt(i.spendLamports) || BigInt(i.maxCostLamports) > BigInt(i.spendLamports) + MAX_RENT_ALLOWANCE)) || (i.lastValidBlockHeight !== undefined && !Number.isSafeInteger(i.lastValidBlockHeight))) throw Error('Invalid journal intent');
    if ((i.state === 'held-ambiguous' || i.state === 'dropped-expired' || i.state.startsWith('reconciled-')) && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(i.signature ?? '')) throw Error('Invalid receipt identity');
    if (i.signature) { if (signatures.has(i.signature)) throw Error('Duplicate submission signature'); signatures.add(i.signature); }
    if (i.state.startsWith('reconciled-')) {
      const r = i.receipt;
      if (!r || r.signature !== i.signature || r.wallet !== i.wallet || r.mint !== i.mint || r.finality !== 'finalized' || !Number.isSafeInteger(r.slot) || r.slot < 1 || r.outcome !== i.state.slice('reconciled-'.length)) throw Error('Invalid saved receipt');
      if (r.outcome === 'confirmed' && (!receiptAmounts(i,r))) throw Error('Invalid saved receipt amount');
    }
    ids.add(i.id);
  }
  if (s.allowlist !== undefined) {
    if (!dynamic(p) || !Array.isArray(s.allowlist) || s.allowlist.length > 500) throw Error('Invalid allowlist');
    const seen = new Set();
    for (const a of s.allowlist) { if (!publicAddress(a?.mint) || seen.has(a.mint) || !timestamp(a.approvedAt) || !timestamp(a.expiresAt) || a.expiresAt <= a.approvedAt || a.expiresAt - a.approvedAt > 86400000) throw Error('Invalid allowlist entry'); seen.add(a.mint); }
  }
  if (s.launchesObserved !== undefined) {
    if (!Array.isArray(s.launchesObserved) || s.launchesObserved.length > 1000) throw Error('Invalid observed launch journal');
    const launches=new Set();
    for (const launch of s.launchesObserved) {
      if (!id(launch.id) || launches.has(launch.id) || launch.id===p.agentId || !publicAddress(launch.wallet) || !publicAddress(launch.mint) || !timestamp(launch.queuedAt) || !timestamp(launch.firstObservedAt) || launch.firstObservedAt<launch.queuedAt || !['observed-blocked','identity-conflict'].includes(launch.state) || launch.rules!=='not-fetched' || launch.acknowledged!==false || launch.executionEnabled!==false) throw Error('Invalid observed launch identity');
      launches.add(launch.id);
    }
  }
  return s;
}
function updated(s, intents) { return { ...s, revision: s.revision + 1, intents }; }
export function expireIntents(s, now) {
  if (!timestamp(now)) throw Error('Invalid clock');
  const intents = s.intents.map(i => ['blocked-execution-disabled', 'planned'].includes(i.state) && i.expiresAt <= now ? { ...i, state: 'expired' } : i);
  return intents.some((i, n) => i !== s.intents[n]) ? updated(s, intents) : s;
}
// Intents are hypothetical inputs. Passing these checks never permits execution.
export function planIntent(state, policy, proposal, observation, risk, now = Date.now(), positions = null) {
  const p = validateTradingPolicy(policy); validateTradingState(state, p);
  if (!timestamp(now)) throw Error('Invalid clock');
  if (!proposal || !id(proposal.id) || proposal.agentId !== p.agentId || proposal.wallet !== p.wallet || !mintPermitted(p, proposal.mint) || (dynamic(p) && proposal.side === 'buy' && !allowlisted(state, proposal.mint, now)) || !validAmounts(proposal,p) || proposal.mint === WSOL || !Number.isSafeInteger(proposal.slippageBps) || proposal.slippageBps < 0 || proposal.slippageBps > p.maxSlippageBps || !timestamp(proposal.createdAt) || proposal.createdAt > now || !timestamp(proposal.expiresAt) || proposal.expiresAt <= now || proposal.expiresAt <= proposal.createdAt || proposal.expiresAt - proposal.createdAt > p.maxIntentAgeMs || now - proposal.createdAt > p.maxIntentAgeMs) throw Error('Invalid or expired proposal');
  const existing = state.intents.find(i => i.id === proposal.id);
  if (existing) {
    if (['agentId','wallet','mint','side','spendLamports','tokenUnits','tokenDecimals','minimumReceiveLamports','slippageBps','createdAt','expiresAt'].some(k => existing[k] !== proposal[k])) throw Error('Idempotency key reused with different intent');
    return state;
  }
  const s = expireIntents(state, now);
  if (!observation || observation.status !== 'observing' || observation.mode !== 'observe-only' || observation.executionEnabled !== false || observation.signingEnabled !== false || observation.house?.wallet !== p.wallet || !integer(observation.house?.balanceLamports)) throw Error('House observer identity or state unavailable');
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt) || now - observedAt > 90000 || observedAt > now) throw Error('House observer is stale');
  const pending = s.intents.filter(i => PENDING.includes(i.state));
  if (pending.some(i => i.state === 'held-ambiguous')) throw Error('Unresolved submission blocks new proposals');
  if (pending.length >= p.maxPendingIntents) throw Error('Policy pending-intent limit reached');
  if (proposal.side === 'buy') {
    if (!risk || risk.wallet !== p.wallet || risk.complete !== true || !integer(risk.exposureLamports) || !integer(risk.dailyLossLamports) || risk.utcDay !== new Date(now).toISOString().slice(0,10) || !timestamp(risk.observedAt) || now - risk.observedAt > 90000 || risk.observedAt > now) throw Error('Current risk snapshot is required');
    const reserved = pending.filter(i=>i.side==='buy').reduce((sum, i) => sum + BigInt(i.spendLamports), 0n), spend = BigInt(proposal.spendLamports);
    if (reserved + spend + BigInt(risk.exposureLamports) > BigInt(p.maxExposureLamports) || reserved + spend + BigInt(p.reserveLamports) > BigInt(observation.house.balanceLamports) || BigInt(risk.dailyLossLamports) >= BigInt(p.maxDailyLossLamports)) throw Error('Policy risk limit reached');
  } else {
    if (!positions || positions.wallet !== p.wallet || positions.complete !== true || positions.source !== 'finalized-rpc-token-accounts' || positions.commitment !== 'finalized' || !timestamp(positions.observedAt) || now - positions.observedAt > 90000 || positions.observedAt > now || !Array.isArray(positions.positions) || !Array.isArray(positions.contextSlots) || positions.contextSlots.length !== 2 || positions.contextSlots.some(slot=>!Number.isSafeInteger(slot)||slot<1)) throw Error('Current finalized positions are required');
    if (positions.positions.some(x=>!publicAddress(x.mint) || !integer(x.tokenUnits) || !integer(x.spendableTokenUnits) || BigInt(x.spendableTokenUnits)>BigInt(x.tokenUnits)) || new Set(positions.positions.map(x=>x.mint)).size!==positions.positions.length) throw Error('Invalid position balances');
    const reconciled = s.intents.filter(i=>i.state==='reconciled-confirmed');
    if (reconciled.some(i=>positions.contextSlots.some(slot=>slot<i.receipt.slot))) throw Error('Position snapshot predates a reconciled receipt');
    const position = positions.positions.find(x=>x.mint===proposal.mint);
    const reserved = pending.filter(i=>i.side==='sell' && i.mint===proposal.mint).reduce((sum,i)=>sum+BigInt(i.tokenUnits),0n);
    if (!position || position.decimals !== proposal.tokenDecimals || reserved + BigInt(proposal.tokenUnits) > BigInt(position.spendableTokenUnits) || BigInt(observation.house.balanceLamports) < BigInt(p.reserveLamports)) throw Error('Insufficient verified position or SOL reserve');
  }
  const fields = ['id','agentId','wallet','mint','side','slippageBps','createdAt','expiresAt',...(proposal.side==='buy'?['spendLamports']:['tokenUnits','tokenDecimals','minimumReceiveLamports'])];
  const intent = Object.fromEntries(fields.map(k => [k, proposal[k]]));
  return updated(s, [...s.intents, executes(p) ? { ...intent, state: 'planned', reason: 'Awaiting execution gates' }
    : { ...intent, state: 'blocked-execution-disabled', reason: 'No signer or transaction transport exists in this worker' }]);
}
// This records an already-known external signature; it never broadcasts anything.
// Once recorded, expiry cannot release the hold or allow a retry.
export function holdExternalSubmission(s, p, intentId, signature, submission = {}) {
  validateTradingState(s, p);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature ?? '')) throw Error('Invalid signature');
  if (s.intents.some(i => i.id !== intentId && i.signature === signature)) throw Error('Signature already belongs to another intent');
  const i = s.intents.find(i => i.id === intentId);
  if (!i || !PENDING.includes(i.state)) throw Error('Cannot record submission in this state');
  if (i.signature && i.signature !== signature) throw Error('Submission signature cannot change');
  if (i.state === 'held-ambiguous') return s;
  const extra = {};
  if (submission.lastValidBlockHeight !== undefined) extra.lastValidBlockHeight = submission.lastValidBlockHeight;
  if (submission.maxCostLamports !== undefined) extra.maxCostLamports = submission.maxCostLamports;
  return validateTradingState(updated(s, s.intents.map(x => x.id === intentId ? { ...x, ...extra, signature, state: 'held-ambiguous', reason: 'Awaiting independently verified finalized receipt' } : x)), p);
}
// The verifier is an injected READ-ONLY chain adapter. There is intentionally no
// default adapter: null/uncertain results leave the intent held across restarts.
export async function reconcileHeldIntent(s, p, intentId, verifier) {
  validateTradingState(s, p);
  const i = s.intents.find(x => x.id === intentId);
  if (!i || i.state !== 'held-ambiguous') throw Error('Only held submissions can reconcile');
  if (typeof verifier !== 'function') return s;
  let receipt; try { receipt = await verifier(Object.freeze({ ...i })); } catch { return s; }
  if (!receipt || receipt.signature !== i.signature || receipt.wallet !== i.wallet || receipt.mint !== i.mint || receipt.finality !== 'finalized' || !Number.isSafeInteger(receipt.slot) || receipt.slot < 1) return s;
  if (receipt.outcome === 'confirmed' && !receiptAmounts(i,receipt)) return s;
  if (!['confirmed','failed'].includes(receipt.outcome)) return s;
  const clean = { signature: receipt.signature, wallet: receipt.wallet, mint: receipt.mint, finality: receipt.finality, slot:receipt.slot, outcome: receipt.outcome };
  if (receipt.outcome === 'confirmed') Object.assign(clean, i.side === 'buy' ? { spentLamports: receipt.spentLamports, receivedTokenUnits: receipt.receivedTokenUnits } : { soldTokenUnits:receipt.soldTokenUnits, receivedLamports:receipt.receivedLamports });
  return updated(s, s.intents.map(x => x.id === intentId ? { ...x, state: `reconciled-${receipt.outcome}`, receipt: clean, reason: 'Read-only verifier returned a matching finalized receipt' } : x));
}

// Only a passed blockhash with the signature never seen is a known non-landing. Anything else holds.
export function dropExpiredSubmission(s, p, intentId, status, blockHeight) {
  validateTradingState(s, p);
  const i = s.intents.find(x => x.id === intentId);
  if (!i || i.state !== 'held-ambiguous') throw Error('Only held submissions can drop');
  if (status !== null || !Number.isSafeInteger(i.lastValidBlockHeight) || !Number.isSafeInteger(blockHeight) || blockHeight <= i.lastValidBlockHeight) return s;
  return updated(s, s.intents.map(x => x.id === intentId ? { ...x, state: 'dropped-expired', reason: 'Blockhash expired; signature never seen on chain' } : x));
}
