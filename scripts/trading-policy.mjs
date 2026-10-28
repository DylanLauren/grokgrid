import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(x);
const timestamp = x => Number.isSafeInteger(x) && x > 0;
export function publicAddress(x) { try { return typeof x === 'string' && new PublicKey(x).toBase58() === x; } catch { return false; } }
export function validateTradingPolicy(p) {
  if (!p || p.version !== 1 || p.mode !== 'observe-only' || p.executionEnabled !== false || p.signingEnabled !== false) throw Error('Execution is disabled in this worker');
  if (!id(p.agentId) || !publicAddress(p.wallet) || !Array.isArray(p.allowedMints) || !p.allowedMints.every(publicAddress) || new Set(p.allowedMints).size !== p.allowedMints.length) throw Error('Invalid pinned identities');
  for (const field of ['maxTradeLamports', 'maxExposureLamports', 'maxDailyLossLamports', 'reserveLamports']) if (!integer(p[field])) throw Error('Invalid integer policy');
  if (BigInt(p.maxTradeLamports) <= 0n || BigInt(p.maxExposureLamports) < BigInt(p.maxTradeLamports) || BigInt(p.maxDailyLossLamports) <= 0n) throw Error('Invalid limits');
  if (!Number.isSafeInteger(p.maxSlippageBps) || p.maxSlippageBps < 0 || p.maxSlippageBps > 1000 || !Number.isSafeInteger(p.maxPendingIntents) || p.maxPendingIntents < 1 || p.maxPendingIntents > 100 || !Number.isSafeInteger(p.maxIntentAgeMs) || p.maxIntentAgeMs < 1000 || p.maxIntentAgeMs > 3600000) throw Error('Invalid timing or execution limits');
  return p;
}
export function policyFingerprint(p) {
  validateTradingPolicy(p);
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(p).sort().map(k => [k, p[k]])))).digest('hex');
}
export function emptyTradingState(p) {
  return { version: 1, revision: 0, policyFingerprint: policyFingerprint(p), agentId: p.agentId, wallet: p.wallet, executionEnabled: false, signingEnabled: false, intents: [] };
}
export function validateTradingState(s, p) {
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || s.policyFingerprint !== policyFingerprint(p) || s.agentId !== p.agentId || s.wallet !== p.wallet || s.executionEnabled !== false || s.signingEnabled !== false || !Array.isArray(s.intents)) throw Error('Journal identity or policy mismatch');
  const ids = new Set(), signatures = new Set();
  for (const i of s.intents) {
    if (!id(i.id) || ids.has(i.id) || i.agentId !== p.agentId || i.wallet !== p.wallet || !p.allowedMints.includes(i.mint) || i.side !== 'buy' || !integer(i.spendLamports) || BigInt(i.spendLamports) <= 0n || BigInt(i.spendLamports) > BigInt(p.maxTradeLamports) || !Number.isSafeInteger(i.slippageBps) || i.slippageBps < 0 || i.slippageBps > p.maxSlippageBps || !timestamp(i.createdAt) || !timestamp(i.expiresAt) || i.expiresAt <= i.createdAt || i.expiresAt - i.createdAt > p.maxIntentAgeMs || !['blocked-execution-disabled', 'expired', 'held-ambiguous', 'reconciled-failed', 'reconciled-confirmed'].includes(i.state)) throw Error('Invalid journal intent');
    if ((i.state === 'held-ambiguous' || i.state.startsWith('reconciled-')) && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(i.signature ?? '')) throw Error('Invalid receipt identity');
    if (i.signature) { if (signatures.has(i.signature)) throw Error('Duplicate submission signature'); signatures.add(i.signature); }
    if (i.state.startsWith('reconciled-')) {
      const r = i.receipt;
      if (!r || r.signature !== i.signature || r.wallet !== i.wallet || r.mint !== i.mint || r.finality !== 'finalized' || r.outcome !== i.state.slice('reconciled-'.length)) throw Error('Invalid saved receipt');
      if (r.outcome === 'confirmed' && (r.spentLamports !== i.spendLamports || !integer(r.receivedTokenUnits) || BigInt(r.receivedTokenUnits) <= 0n)) throw Error('Invalid saved receipt amount');
    }
    ids.add(i.id);
  }
  return s;
}
function updated(s, intents) { return { ...s, revision: s.revision + 1, intents }; }
export function expireIntents(s, now) {
  if (!timestamp(now)) throw Error('Invalid clock');
  const intents = s.intents.map(i => i.state === 'blocked-execution-disabled' && i.expiresAt <= now ? { ...i, state: 'expired' } : i);
  return intents.some((i, n) => i !== s.intents[n]) ? updated(s, intents) : s;
}
// Intents are hypothetical inputs. Passing these checks never permits execution.
export function planIntent(state, policy, proposal, observation, risk, now = Date.now()) {
  const p = validateTradingPolicy(policy); validateTradingState(state, p);
  if (!timestamp(now)) throw Error('Invalid clock');
  if (!proposal || !id(proposal.id) || proposal.agentId !== p.agentId || proposal.wallet !== p.wallet || !p.allowedMints.includes(proposal.mint) || proposal.side !== 'buy' || !integer(proposal.spendLamports) || BigInt(proposal.spendLamports) <= 0n || !Number.isSafeInteger(proposal.slippageBps) || proposal.slippageBps < 0 || proposal.slippageBps > p.maxSlippageBps || !timestamp(proposal.createdAt) || proposal.createdAt > now || !timestamp(proposal.expiresAt) || proposal.expiresAt <= now || proposal.expiresAt <= proposal.createdAt || proposal.expiresAt - proposal.createdAt > p.maxIntentAgeMs || now - proposal.createdAt > p.maxIntentAgeMs) throw Error('Invalid or expired proposal');
  const existing = state.intents.find(i => i.id === proposal.id);
  if (existing) {
    if (['agentId','wallet','mint','side','spendLamports','slippageBps','createdAt','expiresAt'].some(k => existing[k] !== proposal[k])) throw Error('Idempotency key reused with different intent');
    return state;
  }
  const s = expireIntents(state, now);
  if (!observation || observation.status !== 'observing' || observation.mode !== 'observe-only' || observation.executionEnabled !== false || observation.signingEnabled !== false || observation.house?.wallet !== p.wallet || !integer(observation.house?.balanceLamports)) throw Error('House observer identity or state unavailable');
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt) || now - observedAt > 90000 || observedAt > now) throw Error('House observer is stale');
  if (!risk || risk.wallet !== p.wallet || risk.complete !== true || !integer(risk.exposureLamports) || !integer(risk.dailyLossLamports) || risk.utcDay !== new Date(now).toISOString().slice(0,10) || !timestamp(risk.observedAt) || now - risk.observedAt > 90000 || risk.observedAt > now) throw Error('Verified current risk snapshot is required');
  const pending = s.intents.filter(i => ['blocked-execution-disabled', 'held-ambiguous'].includes(i.state));
  if (pending.some(i => i.state === 'held-ambiguous')) throw Error('Unresolved submission blocks new proposals');
  const reserved = pending.reduce((sum, i) => sum + BigInt(i.spendLamports), 0n), spend = BigInt(proposal.spendLamports);
  if (spend > BigInt(p.maxTradeLamports) || pending.length >= p.maxPendingIntents || reserved + spend + BigInt(risk.exposureLamports) > BigInt(p.maxExposureLamports) || reserved + spend + BigInt(p.reserveLamports) > BigInt(observation.house.balanceLamports) || BigInt(risk.dailyLossLamports) >= BigInt(p.maxDailyLossLamports)) throw Error('Policy risk limit reached');
  const intent = Object.fromEntries(['id','agentId','wallet','mint','side','spendLamports','slippageBps','createdAt','expiresAt'].map(k => [k, proposal[k]]));
  return updated(s, [...s.intents, { ...intent, state: 'blocked-execution-disabled', reason: 'No signer or transaction transport exists in this worker' }]);
}
// This records an already-known external signature; it never broadcasts anything.
// Once recorded, expiry cannot release the hold or allow a retry.
export function holdExternalSubmission(s, p, intentId, signature) {
  validateTradingState(s, p);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature ?? '')) throw Error('Invalid signature');
  if (s.intents.some(i => i.id !== intentId && i.signature === signature)) throw Error('Signature already belongs to another intent');
  const i = s.intents.find(i => i.id === intentId);
  if (!i || !['blocked-execution-disabled','held-ambiguous'].includes(i.state)) throw Error('Cannot record submission in this state');
  if (i.signature && i.signature !== signature) throw Error('Submission signature cannot change');
  if (i.state === 'held-ambiguous') return s;
  return updated(s, s.intents.map(x => x.id === intentId ? { ...x, signature, state: 'held-ambiguous', reason: 'Awaiting independently verified finalized receipt' } : x));
}
// The verifier is an injected READ-ONLY chain adapter. There is intentionally no
// default adapter: null/uncertain results leave the intent held across restarts.
export async function reconcileHeldIntent(s, p, intentId, verifier) {
  validateTradingState(s, p);
  const i = s.intents.find(x => x.id === intentId);
  if (!i || i.state !== 'held-ambiguous') throw Error('Only held submissions can reconcile');
  if (typeof verifier !== 'function') return s;
  let receipt; try { receipt = await verifier(Object.freeze({ ...i })); } catch { return s; }
  if (!receipt || receipt.signature !== i.signature || receipt.wallet !== i.wallet || receipt.mint !== i.mint || receipt.finality !== 'finalized') return s;
  if (receipt.outcome === 'confirmed' && (!integer(receipt.spentLamports) || receipt.spentLamports !== i.spendLamports || !integer(receipt.receivedTokenUnits) || BigInt(receipt.receivedTokenUnits) <= 0n)) return s;
  if (!['confirmed','failed'].includes(receipt.outcome)) return s;
  const clean = { signature: receipt.signature, wallet: receipt.wallet, mint: receipt.mint, finality: receipt.finality, outcome: receipt.outcome };
  if (receipt.outcome === 'confirmed') Object.assign(clean, { spentLamports: receipt.spentLamports, receivedTokenUnits: receipt.receivedTokenUnits });
  return updated(s, s.intents.map(x => x.id === intentId ? { ...x, state: `reconciled-${receipt.outcome}`, receipt: clean, reason: 'Read-only verifier returned a matching finalized receipt' } : x));
}
