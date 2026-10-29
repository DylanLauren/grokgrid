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
  return { fire, pending: fire ? null : { reason, at: p && p.reason === reason ? p.at : now } };
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
