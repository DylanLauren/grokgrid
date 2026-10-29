// Pure helper for scripts/exit-watcher.mjs.

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
