import { createHash } from 'node:crypto';
import { address } from './runtime-policy.mjs';

// Buy-and-burn rules. Pure functions; amounts are integer strings, never floats.
// A cycle is written to the journal, with its transaction signature, BEFORE broadcast.
// An outcome we cannot prove (no finalized status while the blockhash is still valid)
// holds the cycle; nothing new is planned until it resolves. No unknown outcome is retried.
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(x);
const signature = x => typeof x === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(x);
const timestamp = x => Number.isSafeInteger(x) && x > 0;
const height = x => Number.isSafeInteger(x) && x > 0;
export const TERMINAL = ['burned', 'buy-failed', 'buy-expired', 'nothing-to-burn'];
const STATES = ['buy-pending', 'buy-finalized', 'burn-pending', ...TERMINAL];

export function validateBuybackConfig(c) {
  if (!c || c.version !== 1) throw Error('Unsupported buyback config');
  if (typeof c.executionEnabled !== 'boolean' || typeof c.signingEnabled !== 'boolean') throw Error('Execution flags must be explicit booleans');
  if (!address(c.burnWallet) || (c.officialMint !== null && !address(c.officialMint))) throw Error('Invalid pinned identities');
  if (typeof c.stopFile !== 'string' || !c.stopFile.startsWith('/')) throw Error('An absolute stop-file path is required');
  if (c.signingEnabled && (typeof c.keypairFile !== 'string' || !c.keypairFile.startsWith('/'))) throw Error('Signing needs an absolute keypair path');
  for (const k of ['triggerLamports', 'maxSpendLamports', 'reserveLamports', 'feeAllowanceLamports']) if (!integer(c[k])) throw Error(`Invalid ${k}`);
  if (BigInt(c.triggerLamports) <= 0n || BigInt(c.maxSpendLamports) < BigInt(c.triggerLamports) || BigInt(c.maxSpendLamports) > 10_000_000_000n) throw Error('Invalid spend limits');
  if (!Number.isSafeInteger(c.maxSlippageBps) || c.maxSlippageBps < 1 || c.maxSlippageBps > 2000) throw Error('Invalid slippage limit');
  return c;
}

export function configFingerprint(c) {
  validateBuybackConfig(c);
  const pinned = ['burnWallet', 'officialMint', 'triggerLamports', 'maxSpendLamports', 'reserveLamports', 'feeAllowanceLamports', 'maxSlippageBps'];
  return createHash('sha256').update(JSON.stringify(pinned.map(k => [k, c[k]]))).digest('hex');
}

export function emptyBuybackState(c) {
  return { version: 1, revision: 0, burnWallet: c.burnWallet, officialMint: c.officialMint, cycles: [] };
}

export function validateBuybackState(s, c) {
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || s.burnWallet !== c.burnWallet || !Array.isArray(s.cycles)) throw Error('Buyback journal identity mismatch');
  if (s.officialMint !== c.officialMint && s.cycles.some(x => !TERMINAL.includes(x.state))) throw Error('Mint changed while a cycle is open');
  const ids = new Set(), sigs = new Set();
  for (const x of s.cycles) {
    if (!id(x.id) || ids.has(x.id) || !STATES.includes(x.state) || !address(x.mint) || !timestamp(x.createdAt) || !integer(x.spendLamports) || !integer(x.minTokenUnits)) throw Error('Invalid buyback cycle');
    for (const leg of [x.buy, x.burn]) if (leg) {
      if (!signature(leg.signature) || !height(leg.lastValidBlockHeight) || sigs.has(leg.signature)) throw Error('Invalid or duplicate cycle signature');
      sigs.add(leg.signature);
    }
    if (!x.buy) throw Error('A cycle exists only once its buy is signed');
    if (['burn-pending', 'burned'].includes(x.state) && (!x.burn || !integer(x.burn.tokenUnits) || BigInt(x.burn.tokenUnits) <= 0n)) throw Error('Burn leg missing');
    ids.add(x.id);
  }
  return s;
}

export const openCycle = s => s.cycles.find(x => !TERMINAL.includes(x.state)) || null;
const bump = (s, cycles) => ({ ...s, revision: s.revision + 1, cycles });
const patch = (s, cycleId, fields) => bump(s, s.cycles.map(x => x.id === cycleId ? { ...x, ...fields } : x));

/** Every reason this tick must not sign. An empty list is the only path to execution. */
export function executionBlockers(c, { stopFilePresent, mintVerified, keypairMatches, observedMint }) {
  const blockers = [];
  if (!c.executionEnabled) blockers.push('execution-disabled');
  if (!c.signingEnabled) blockers.push('signing-disabled');
  if (stopFilePresent !== false) blockers.push('stop-switch-engaged');
  if (!c.officialMint) blockers.push('awaiting-official-mint');
  else if (observedMint !== c.officialMint) blockers.push('mint-mismatch');
  else if (mintVerified !== true) blockers.push('mint-unverified');
  if (c.signingEnabled && keypairMatches !== true) blockers.push('keypair-unverified');
  return blockers;
}

/** How much SOL this cycle may spend, or null below the trigger. */
export function plannedSpend(c, balanceLamports) {
  if (!integer(balanceLamports)) throw Error('Invalid balance');
  const free = BigInt(balanceLamports) - BigInt(c.reserveLamports) - BigInt(c.feeAllowanceLamports);
  if (BigInt(balanceLamports) < BigInt(c.triggerLamports) || free <= 0n) return null;
  const spend = free < BigInt(c.maxSpendLamports) ? free : BigInt(c.maxSpendLamports);
  return spend.toString();
}

export function recordBuy(s, c, { cycleId, spendLamports, minTokenUnits, signature: sig, lastValidBlockHeight, now }) {
  validateBuybackState(s, c);
  if (openCycle(s)) throw Error('A cycle is already open');
  if (!c.officialMint) throw Error('No official mint');
  if (!integer(spendLamports) || BigInt(spendLamports) <= 0n || BigInt(spendLamports) > BigInt(c.maxSpendLamports)) throw Error('Spend outside limits');
  if (s.cycles.some(x => x.id === cycleId)) throw Error('Cycle id reused');
  const cycle = { id: cycleId, mint: c.officialMint, createdAt: now, spendLamports, minTokenUnits, state: 'buy-pending',
    buy: { signature: sig, lastValidBlockHeight } };
  return validateBuybackState(bump(s, [...s.cycles, cycle]), c);
}

/**
 * Advance a pending leg from read-only chain facts:
 * status = null (not seen) | { finalized: true, err: null|object }; blockHeight = current finalized height.
 */
export function settleLeg(s, c, cycleId, leg, status, blockHeight) {
  validateBuybackState(s, c);
  const x = s.cycles.find(y => y.id === cycleId);
  const pending = leg === 'buy' ? 'buy-pending' : 'burn-pending';
  if (!x || x.state !== pending) throw Error('Leg is not pending');
  if (status && status.finalized === true) {
    if (leg === 'buy') return patch(s, cycleId, { state: status.err ? 'buy-failed' : 'buy-finalized' });
    // A failed burn leaves the tokens in place; the next tick plans a fresh burn of the real balance.
    return status.err ? patch(s, cycleId, { state: 'buy-finalized', burn: undefined, failedBurns: [...(x.failedBurns || []), x.burn.signature] })
      : patch(s, cycleId, { state: 'burned' });
  }
  // Not finalized. Only once the blockhash can never land again is "not seen" a known outcome.
  if (status === null && height(blockHeight) && blockHeight > x[leg].lastValidBlockHeight) {
    return leg === 'buy' ? patch(s, cycleId, { state: 'buy-expired' })
      : patch(s, cycleId, { state: 'buy-finalized', burn: undefined, expiredBurns: [...(x.expiredBurns || []), x.burn.signature] });
  }
  return s; // unknown: hold
}

export function recordBurn(s, c, cycleId, { tokenUnits, signature: sig, lastValidBlockHeight }) {
  validateBuybackState(s, c);
  const x = s.cycles.find(y => y.id === cycleId);
  if (!x || x.state !== 'buy-finalized') throw Error('Burn only follows a finalized buy');
  if (!integer(tokenUnits) || BigInt(tokenUnits) <= 0n) throw Error('Nothing to burn');
  return validateBuybackState(patch(s, cycleId, { state: 'burn-pending', burn: { tokenUnits, signature: sig, lastValidBlockHeight } }), c);
}

export function closeEmpty(s, c, cycleId) {
  validateBuybackState(s, c);
  const x = s.cycles.find(y => y.id === cycleId);
  if (!x || x.state !== 'buy-finalized') throw Error('Only a finalized buy can close empty');
  return patch(s, cycleId, { state: 'nothing-to-burn' });
}
