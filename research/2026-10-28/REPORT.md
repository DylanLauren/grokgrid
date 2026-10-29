# GrokGrid strategy research — October 28, 2026

**Decision: no live strategy is validated by this research. Keep signing disabled.**

Initial leaderboard research was performed through Dylan's existing Chrome window; the transaction audit below uses existing authorized Helius API access. No account, API plan, coin, trade, or wallet signature was purchased or created. “Above $5k” was interpreted as reported realized profit above $5,000 in the provider's selected 30-day window.

## Coverage and limits

Captured 500 FOMO leaderboard entries and 100 Pump.fun-app leaderboard entries, with public addresses and displayed metrics, from Solana Tracker. These are app-attributed leaderboards, not all Pump.fun-origin token activity across every trading venue. The FOMO snapshot still ends above $10k: it does not enumerate every wallet above $5k.

Attempted expanded PnL histories for the top five entries on each board. Details below distinguish successful captures from unavailable histories. Token rows are wallet-history aggregates, not an export of every purchase. The selected 30D chart does NOT restrict all token rows to 30 days: some rows are hundreds of days old. A last-activity age is not an entry timestamp. No per-entry volume or liquidity result can be inferred from those rows.

The snapshots contain provider-reported rounded values, not audited on-chain PnL. Full mint addresses were not exposed in the captured token table; duplicate symbols must not be conflated. “Transferred in” rows are separated rather than counted as repeatable trading wins. Provider panels also disagree about some date labels and drawdowns; preserve the source text rather than silently reconcile them.

## Wallet history audit

| Wallet/source | Captured token rows | Transfer-marked rows | Largest reported realized winner | Other captured realized PnL, excluding transfers and largest winner |
|---|---:|---:|---|---:|
| [fomo-top1](https://www.solanatracker.io/wallet/AGdtsMmphhymH5wYW3dWKSkAxpLYRrNDCTFAfuq8ii9v) | 197 | 15 | SI: $811,500.00 | $-53,549.68 |
| [fomo-top2](https://www.solanatracker.io/wallet/498g1rVnFcnjBjpfw1xyqA1WvgQXUU8RWuELjxkjAayQ) | 911 | 190 | STONK: $885,220.00 | $747,602.86 |
| [fomo-top3](https://www.solanatracker.io/wallet/9PB1RLFsp65qLJ1SQMmcx2ff8Zn6cPYkYqMCWUfVC3sc) | unavailable | — | — | — |
| [fomo-top4](https://www.solanatracker.io/wallet/HvvEk6DkVfri3xGqvh4KK3eVqtGT6RRvdWaaKBA5j1gV) | unavailable | — | — | — |
| [fomo-top5](https://www.solanatracker.io/wallet/5RZPhPW9qGEd3hRGibgYaF5Yk2jBzXR1VZMKSP71C3Lb) | 393 | 38 | SI: $633,440.00 | $-204,753.64 |
| [pumpfun-top1](https://www.solanatracker.io/wallet/BKXBzzDCAzXW8oy1twKkEWuGe4TFznWCjv5JSsqpECo3) | 32 | 8 | SKR: $23,130,000.00 | $5.24 |
| [pumpfun-top2](https://www.solanatracker.io/wallet/8bjZiTy5NRhZoX6PyEL8yZiu3PTbcvGxLSApJdyv6vXD) | unavailable | — | — | — |
| [pumpfun-top3](https://www.solanatracker.io/wallet/FYN6YTuZ2T8ixnQzouMJ3TEiVGqJuCJkeHDgP6fQe4hw) | 40 | 5 | SKR: $11,800,000.00 | $254.36 |
| [pumpfun-top4](https://www.solanatracker.io/wallet/GEkyVWgf5ugVkvdU8GwUDKd9jdkkXrz3qNy14823GSCM) | 2,048 | 33 | swordcat: $9,910,000.00 | $-5,399.30 |
| [pumpfun-top5](https://www.solanatracker.io/wallet/CFzVktB6sfK8rpewZeJ5VRPcvG5BBtK6pSbZ7FHVze4V) | unavailable | — | — | — |

**The final column is a diagnostic on captured lifetime token rows, not a 30-day backtest, not a copy-trading return, and not proof of misconduct.** It is especially unreliable when a large figure is rounded to millions or acquisition history is incomplete.

## Findings that change the strategy choice

1. **Single-winner dependence.** ExactTallTakin's history shows about $811.5k realized from SI, while non-transfer rows excluding SI sum to approximately -$53.5k. 333 shows about $633.4k from SI and approximately -$204.8k on the remaining non-transfer rows. These are candidates for further acquisition-history investigation, not evidence for indiscriminate copying.
2. **Platform profit and whole-wallet profit differ.** Frank's FOMO leaderboard reports about $735k, while its wallet 30D panel reports about $778k. Its complete table includes 911 tokens, 190 transfer-marked rows, and large older positions. Do not combine these scopes as if they measured the same sample.
3. **Huge ROI does not establish a reproducible trade.** The Pump.fun-app leaders include SKR and swordcat rows reporting millions in realized PnL against tiny recorded invested amounts. Verify mint identity, transfers, acquisition cost, and execution prices before attributing the result to a trading strategy. The present data cannot establish the cause.
4. **Volume is not interchangeable.** Wallet turnover is not the token's market volume at entry. Current 24-hour volume is not historical pre-entry volume. The requested “best volume to buy” remains unmeasured.
5. **Win rate alone is insufficient.** Some high-profit leaderboard entries win fewer than half their positions. A profitable median trade, total profit, concentration, open losses, capital requirements and copy latency can tell very different stories.

## Strategy research to run before real orders

Use `trade-evidence-schema.csv` as the required transaction-level dataset. Resolve canonical mint and wallet addresses; recover starting inventory before the window; reconstruct fills and transfers; reconcile amounts to confirmed transactions. Include failed transaction fees, priority fees, tips, platform fees and open-position losses. Separate team-related, gifted and unpriced inventory from acquired inventory. Do not use future information at entry.

Measure pre-entry 1m/5m/1h token volume, liquidity, token age, holder concentration, unique buyers/sellers, position size and observed entry delay. Test volume divided by liquidity and trade size divided by liquidity, not just absolute volume. Compare wins and losses, including tokens that died or became unsellable. Aggregate repeat entries carefully so one token is not counted as many independent successful signals.

Select candidates using an earlier period, then evaluate on later unseen periods and entirely held-out wallets/tokens. Stress execution delay and realistic slippage. Report net expectancy, profit factor, drawdown, capital employed, tail losses and share of profit from the largest token; repeat after removing the best token and transfer-origin inventory. Require sufficient independent observations rather than optimizing a tiny sample.

A first strategy to TEST is limited-size entries in independently verified, liquid tokens with increasing genuine buyer activity. This is a research hypothesis, not a recommended live rule. No numerical volume, take-profit, stop-loss, or position-size threshold has been empirically selected here. No “god strategy” or guaranteed-profit claim is supported.

## What prevents exhaustive completion

The visible leaderboard sample is finite. Several high-ranked profiles return no PnL data. The accessible UI does not provide a complete canonical-mint, timestamped fill export with historical entry-state data. Completing every qualifying wallet and every purchase requires those underlying exports or authorized indexed data access. No paid access was enabled and no unavailable observations were invented.

## Files

- `leaderboard-wallets.csv`: 600 observed leaderboard records and full public wallet addresses.
- `token-history.csv`: every successfully parsed displayed token-history row, with source, scope, raw row, transfer flag, and rounded metrics.
- `analysis.json`: per-wallet counts, winners, losers and concentration diagnostics.
- `*-30d.json` and `*-pnl.json`: timestamped raw browser captures.
- `trade-evidence-schema.csv`: fields needed for a valid entry-parameter analysis.

## Sources

- [FOMO 30D leaderboard](https://www.solanatracker.io/leaderboard/fomo)
- [Pump.fun-app 30D leaderboard](https://www.solanatracker.io/leaderboard/pumpfun)
- Individual wallet links in the audit table.

## Independent methodological cross-check

[Bitquery's October 22 investigation](https://bitquery.io/investigations/who-got-rich-on-pumpfun) examined 3,170 large wins ending October 30, 2025–August 30, 2026. It classified 26% of the reported profit as ordinary trading profit and separated token hand-offs and linked-wallet wash loops. That older sample is not this requested 30-day cohort and cannot classify any wallet reviewed here. It supports the need to trace inventory origin and counterparty funding before selecting leaderboard wallets. Its published profit figures exclude transaction fees.

## Data access needed for the next stage

The [official PnL V2 guide](https://docs.solanatracker.io/guides/pnl-v2/wallet-analysis) documents wallet positions, single-mint positions, daily history and period performance, with an API key required. It distinguishes strict, adjusted and raw cost-basis handling, and identifies supported date parameters per endpoint. These documented endpoints are a suitable acquisition path to investigate with existing authorized access; access was not purchased and endpoint completeness for this cohort remains unverified.

[Official historical chart documentation](https://docs.solanatracker.io/guides/price-and-charts) provides timestamp-bounded OHLCV and pool-specific candles with API-key authentication. A complete entry study must join those candles strictly before each actual fill; present-day volume is not a substitute. Historical liquidity and holder-state coverage still needs separate verification.

Final capture totals: 600 leaderboard records; 3,621 parsed token-history rows across six detailed wallets. Four attempted top-ten profiles returned no PnL data after retry. All ten attempts and their outcomes are saved.

## Existing-access transaction follow-up

Existing authorized Helius access now supplies timestamped transaction history. See [TRANSACTION-AUDIT.md](TRANSACTION-AUDIT.md) for current retrieval coverage, actual mint identities, cash-flow evidence and remaining limitations. The earlier UI-only access limitation is superseded for transaction history, but historical entry volume/liquidity and audited cost basis remain unresolved.
