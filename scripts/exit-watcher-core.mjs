// Pure helpers for scripts/exit-watcher.mjs.

export const CONFIRM_WINDOW_MS = 20_000;

/**
 * A quote-triggered exit fires only when the same exit was also seen on the previous check
 * (a few seconds earlier, within CONFIRM_WINDOW_MS), so one manipulated or glitched quote in a
 * single slot cannot force a sale. Returns { fire, pending } where pending is the next state.
 */
export function confirmExit(previous, mint, reason, now) {
  const p = previous?.[mint];
  const fire = !!p && p.reason === reason && now - p.at > 0 && now - p.at <= CONFIRM_WINDOW_MS;
  // A same-reason sighting at this instant is kept; anything stale or different starts over now,
  // so an old sighting can never block confirmation for good.
  const keep = !!p && p.reason === reason && now - p.at >= 0 && now - p.at <= CONFIRM_WINDOW_MS;
  return { fire, pending: fire ? null : { reason, at: keep ? p.at : now } };
}

/**
 * SOL per whole token implied by an on-chain sell quote for the spendable balance: what selling
 * would actually return now, net of pump.fun fees. Same unit as the strategy's priceSol.
 */
export function quotePrices(held, quotes) {
  const prices = new Map();
  for (const p of held) {
    const q = quotes.get(p.mint), units = Number(p.spendableTokenUnits) / 10 ** p.decimals;
    if (q && units > 0) { const price = Number(BigInt(q)) / 1e9 / units; if (Number.isFinite(price) && price > 0) prices.set(p.mint, price); }
  }
  return prices;
}

/** A sell for this coin was already confirmed and planned but expired unsent: re-plan at once. */
export const sellJustExpired = (intents, mint, now) =>
  (intents || []).some(i => i.side === 'sell' && i.mint === mint && i.state === 'expired' && now - i.createdAt >= 0 && now - i.createdAt < 120_000);

/**
 * Coins a user bot probably holds, from its own journal: those whose latest finalized trade is a
 * buy. Only these bots get their wallet read every few seconds, so idle bots cost nothing.
 */
export function heldFromJournal(intents) {
  const last = new Map();
  for (const i of [...(intents || [])].filter(i => i.state === 'reconciled-confirmed').sort((a, b) => a.createdAt - b.createdAt)) last.set(i.mint, i.side);
  return new Set([...last].filter(([, side]) => side === 'buy').map(([mint]) => mint));
}
