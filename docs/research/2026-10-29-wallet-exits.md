# How the top wallets exit (2026-10-29)

Source: the 30-day transaction audit of 10 leaderboard wallets ([2026-10-28 audit](2026-10-28-transaction-audit.md)). Swaps were paired into round trips per wallet, mint and quote currency (SOL or USDC). A trip's return compares the proceeds with the cost of the part actually sold. Trips that sold under 5% of the position are left out.

**Sample:** 293 round trips from 9 wallets. This is a small, survivor-biased sample (leaderboard wallets). It describes how they exit, not how to pick entries.

| | Winners | Losers |
|---|---|---|
| Share of trips | 52% | 48% |
| Median return | **+28%** (p25 +10%, p75 +95%) | **−16%** (p75 −7%, p25 −46%) |
| Median time to the **first** sell | **1.8 min** | 10 min |
| Median number of sells | 2 (p75 4) | 1 |
| Median hold until the last sell | 17 min | 18 min |

**Hold time vs. win rate:**

| Hold | Trips | Win rate | Median return |
|---|---|---|---|
| < 5 min | 83 | 49% | −0.3% |
| 5–30 min | 70 | 54% | +7.5% |
| 30–120 min | 22 | 55% | +4.7% |
| 2–24 h | 58 | 47% | −3.1% |
| > 24 h | 53 | 57% | +12.1% |

The best trips returned +469% to +5,188%: a few very large winners carry the totals.

## What it suggests

These are hypotheses for the backtester, not settled rules.
1. **The edge is in the exits, not a high win rate.** About a coin flip of winners, but losers are cut small (median −16%) and winners are allowed to be large.
2. **Scale out.** Winners take a first partial profit within minutes and sell in pieces. Losers are usually exited in one sell, later.
3. **For GrokGrid:**
   - Test a tighter stop (≈ −15%).
   - Test a partial take-profit (sell about half at +25–30%) with a trailing stop on the rest.
   - Today's exits are the opposite: all-out at +60% and a −25% stop.
   - `scripts/market-analyze.mjs` should add partial exits before we choose.
