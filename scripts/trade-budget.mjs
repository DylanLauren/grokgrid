// Trade size that follows the bot's income and wallet: the more creator fees it actually receives
// and the more spendable SOL it holds, the bigger each buy, up to a cap set by its fee tier and
// never above the hard limits in its trading policy. Pure. The trading policy still enforces its
// own hard limits, reserve and slippage on top; this can only make a bot spend less, never more.
//
//   fee tier (creator fees received in the last 24h, rolling, so it falls when fees dry up):
//     < 1 SOL → 0.02 SOL cap · ≥ 1 → 0.05 · ≥ 5 → 0.1 · ≥ 10 → 0.5 (absolute maximum)
//   cap        = min(tier cap, policy hard per-trade limit)
//   spendable  = wallet − reserve − open cost basis (never negative)
//   perTrade   = clamp(max(10% of 24h fees, 2% of spendable), floor, cap)
//   exposure   = min(3 × tier cap, 25% of spendable, policy hard exposure limit)
//   daily loss = min(2.5 × tier cap, 20% of wallet, policy hard daily loss limit)
//
// floor is the configured per-trade size (itself never above the cap).
const SOL = 1_000_000_000n;
export const FEE_TIERS = Object.freeze([[10n * SOL, SOL / 2n], [5n * SOL, SOL / 10n], [SOL, SOL / 20n], [0n, SOL / 50n]]);
const min = (...v) => v.reduce((a, b) => (b < a ? b : a)), max = (a, b) => (a > b ? a : b);
const lamports = x => { try { const v = BigInt(x); return v > 0n ? v : 0n; } catch { return 0n; } };
export const tierCap = fees => FEE_TIERS.find(([at]) => lamports(fees) >= at)[1];

export function tradeBudget({ floorLamports, capLamports, exposureCapLamports, dailyLossCapLamports, walletLamports, reserveLamports, openCostLamports, feesLamports24h }) {
  const fees = lamports(feesLamports24h), tier = tierCap(fees), cap = min(tier, lamports(capLamports));
  const floor = min(lamports(floorLamports), cap), wallet = lamports(walletLamports);
  const spendable = max(0n, wallet - lamports(reserveLamports) - lamports(openCostLamports));
  const want = max(fees / 10n, spendable * 2n / 100n);
  const perTrade = min(max(want, floor), cap);
  const exposure = min(tier * 3n, spendable / 4n, lamports(exposureCapLamports));
  const dailyLoss = min(tier * 5n / 2n, wallet / 5n, lamports(dailyLossCapLamports ?? tier * 5n / 2n));
  return { tierCapLamports: tier.toString(), perTradeLamports: perTrade.toString(), exposureLamports: exposure.toString(), dailyLossLamports: dailyLoss.toString(),
    spendableLamports: spendable.toString(), feesLamports24h: fees.toString(),
    reason: perTrade === cap && want > cap ? 'cap' : perTrade === floor && want <= floor ? 'floor' : want === fees / 10n ? 'fees' : 'balance' };
}

/**
 * Creator fees this bot actually received in the last 24h: fee-distributor payouts that
 * confirmed on chain for its own coin(s), times its share. Unconfirmed sends and estimates of
 * unclaimed fees never count.
 */
export function feesReceived24h(distributorState, mints, shareBps, now) {
  let total = 0n;
  for (const e of distributorState?.history || [])
    if (mints.includes(e?.mint) && e?.confirmed === true && Number.isSafeInteger(e.at) && now - e.at >= 0 && now - e.at < 86_400_000) total += lamports(e.lamports) * BigInt(shareBps) / 10000n;
  return total.toString();
}
