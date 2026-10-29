// Executes planned intents for a policy in explicit 'execute' mode. One transaction in
// flight at a time: the signed signature is written to the journal before broadcast, and
// nothing new is signed while any submission is unresolved.
import { executes, holdExternalSubmission, MAX_RENT_ALLOWANCE, validateTradingPolicy, validateTradingState } from './trading-policy.mjs';

const day = now => new Date(now).toISOString().slice(0, 10);

/**
 * Risk from the journal alone.
 * - Exposure is the cost basis still open: what was paid for tokens not yet sold, pro rata
 *   per coin, so a coin sold flat leaves nothing behind. Realised losses are not exposure.
 * - Daily loss is today's net outflow, so today's realised losses count there.
 * Cost includes any rent a buy paid, which only ever stops trading sooner.
 */
export function journalRisk(state, wallet, now) {
  let todaySpent = 0n, todayReceived = 0n;
  const open = new Map(); // mint -> { cost, tokens }
  const done = state.intents.filter(i => i.state === 'reconciled-confirmed').sort((a, b) => a.createdAt - b.createdAt);
  for (const i of done) {
    const today = day(i.createdAt) === day(now), o = open.get(i.mint) || { cost: 0n, tokens: 0n };
    if (i.side === 'buy') {
      const spent = BigInt(i.receipt.spentLamports);
      o.cost += spent; o.tokens += BigInt(i.receipt.receivedTokenUnits); if (today) todaySpent += spent;
    } else {
      const sold = BigInt(i.receipt.soldTokenUnits);
      if (sold >= o.tokens) { o.cost = 0n; o.tokens = 0n; }
      else { o.cost -= o.cost * sold / o.tokens; o.tokens -= sold; }
      if (today) todayReceived += BigInt(i.receipt.receivedLamports);
    }
    open.set(i.mint, o);
  }
  const exposure = [...open.values()].reduce((n, o) => n + o.cost, 0n);
  const floor = x => (x > 0n ? x : 0n).toString();
  return { wallet, complete: true, exposureLamports: exposure.toString(), dailyLossLamports: floor(todaySpent - todayReceived), utcDay: day(now), observedAt: now };
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
 * deps: build(intent) -> { tx, lastValidBlockHeight } | null, sign(tx) -> void | signed tx, signatureOf(tx).
 */
export async function signNext(state, policy, deps, now) {
  validateTradingPolicy(policy); validateTradingState(state, policy);
  const pick = nextExecutable(state, policy, now, deps.stopFilePresent);
  if (!pick.intent) return { state, tx: null, reason: pick.reason };
  const built = await deps.build(pick.intent);
  if (!built) return { state, tx: null, reason: 'no-supported-route' };
  // A local keypair signs in place; a remote signer (Privy) returns a new signed transaction.
  const tx = (await deps.sign(built.tx)) || built.tx;
  const maxCostLamports = pick.intent.side === 'buy' ? (BigInt(pick.intent.spendLamports) + MAX_RENT_ALLOWANCE).toString() : undefined;
  const next = holdExternalSubmission(state, policy, pick.intent.id, deps.signatureOf(tx), { lastValidBlockHeight: built.lastValidBlockHeight, maxCostLamports });
  return { state: next, tx, reason: 'signed', intentId: pick.intent.id };
}
