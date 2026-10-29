// Executes planned intents for a policy in explicit 'execute' mode. One transaction in
// flight at a time: the signed signature is written to the journal before broadcast, and
// nothing new is signed while any submission is unresolved.
import { executes, holdExternalSubmission, MAX_RENT_ALLOWANCE, validateTradingPolicy, validateTradingState } from './trading-policy.mjs';

const day = now => new Date(now).toISOString().slice(0, 10);

/**
 * Conservative risk from the journal alone. Cost basis isn't verified, so every unsold
 * lamport spent counts as exposure, and today's net outflow counts as today's loss.
 * That overstates both, which only ever stops trading sooner.
 */
export function journalRisk(state, wallet, now) {
  let spent = 0n, received = 0n, todaySpent = 0n, todayReceived = 0n;
  for (const i of state.intents) {
    if (i.state !== 'reconciled-confirmed') continue;
    const today = day(i.createdAt) === day(now);
    if (i.side === 'buy') { spent += BigInt(i.receipt.spentLamports); if (today) todaySpent += BigInt(i.receipt.spentLamports); }
    else { received += BigInt(i.receipt.receivedLamports); if (today) todayReceived += BigInt(i.receipt.receivedLamports); }
  }
  const floor = x => (x > 0n ? x : 0n).toString();
  return { wallet, complete: true, exposureLamports: floor(spent - received), dailyLossLamports: floor(todaySpent - todayReceived), utcDay: day(now), observedAt: now };
}

/** The next intent this tick may sign, or why none. */
export function nextExecutable(state, policy, now, stopFilePresent) {
  if (!executes(policy)) return { reason: 'observe-only' };
  if (stopFilePresent !== false) return { reason: 'stop-switch-engaged' };
  if (state.intents.some(i => i.state === 'held-ambiguous')) return { reason: 'submission-unresolved' };
  const risk = journalRisk(state, policy.wallet, now);
  if (BigInt(risk.dailyLossLamports) >= BigInt(policy.maxDailyLossLamports)) return { reason: 'daily-loss-stop' };
  const intent = state.intents.find(i => i.state === 'planned' && i.expiresAt > now + 5000);
  if (!intent) return { reason: 'nothing-planned' };
  if (intent.side === 'buy' && BigInt(risk.exposureLamports) + BigInt(intent.spendLamports) > BigInt(policy.maxExposureLamports)) return { reason: 'exposure-limit' };
  return { intent };
}

/**
 * Builds and signs one intent, then journals the signature. Returns the signed transaction
 * for the caller to broadcast only after the returned state is durably stored.
 * deps: build(intent) -> { tx, lastValidBlockHeight } | null, sign(tx), signatureOf(tx).
 */
export async function signNext(state, policy, deps, now) {
  validateTradingPolicy(policy); validateTradingState(state, policy);
  const pick = nextExecutable(state, policy, now, deps.stopFilePresent);
  if (!pick.intent) return { state, tx: null, reason: pick.reason };
  const built = await deps.build(pick.intent);
  if (!built) return { state, tx: null, reason: 'no-supported-route' };
  deps.sign(built.tx);
  const maxCostLamports = pick.intent.side === 'buy' ? (BigInt(pick.intent.spendLamports) + MAX_RENT_ALLOWANCE).toString() : undefined;
  const next = holdExternalSubmission(state, policy, pick.intent.id, deps.signatureOf(built.tx), { lastValidBlockHeight: built.lastValidBlockHeight, maxCostLamports });
  return { state: next, tx: built.tx, reason: 'signed', intentId: pick.intent.id };
}
