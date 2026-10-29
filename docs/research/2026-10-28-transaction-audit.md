# Transaction audit using existing access

Existing Helius access was verified and used without purchasing a plan. No private keys were used. Public transaction records are saved locally.

Downloaded 25,398 records across 10 selected wallets; 9 histories reached the cutoff.

Window: September 28, 2026 19:02:53 UTC through October 28, 2026 19:02:53 UTC. This fixed rolling window is not guaranteed to match the leaderboard daily chart boundaries. A history reaching the cutoff means successful pagination of this provider endpoint, not independently proven completeness across every token account or decoder.

| Wallet | Records downloaded | Within window | Reached cutoff | Oldest returned UTC |
|---|---:|---:|---|---|
| frank 🎒 | 5,700 | 5,679 | Yes | 2026-09-28 16:41 |
| 333 | 4,300 | 4,255 | Yes | 2026-09-28 16:38 |
| horriblee | 3,699 | 3,663 | Yes | 2026-09-28 16:50 |
| B3N_ | 1,700 | 1,618 | Yes | 2026-09-27 17:43 |
| ExactTallTakin | 1,900 | 1,818 | Yes | 2026-09-22 18:18 |
| superdolphingru | 2,300 | 2,259 | Yes | 2026-09-28 12:18 |
| moonlobsterdisc | 2,499 | 2,493 | No — bounded retrieval | 2026-10-27 13:57 |
| davidewangwr | 400 | 346 | Yes | 2026-09-23 19:58 |
| gekyvw | 1,500 | 1,448 | Yes | 2026-09-01 13:45 |
| Zapoleon | 1,400 | 1,317 | Yes | 2026-09-27 10:44 |

## Verified observations

- ExactTallTakin: 1,818 address-history records fall in this window. The audit identifies 194 distinct nonquote mints, including transfer-only tokens. They are not all purchased tokens.
- Helius asset metadata identifies `DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP` as Super Inu (SI). In 27 transactions affecting SI, the observed USDC net flow is +852,526.488935, and SI net flow is -17,030,697.857758. That is cash flow, not PnL. The cumulative token flows require opening inventory, whose acquisition cost is not reconciled here. See exacttalltakin-si-flows.json for signatures.
- The first sampled PUMP_FUN-labeled record was a tiny token inflow with no wallet SOL outflow. Provider source labels alone cannot identify purchases.

## Classification and limitations

The working evidence file (not kept in the repository) retained wallet, signature, timestamp, exact mint, exact decimal token balance change, provider type/source, quote balance changes and transaction fee payer. A provider-swap classification requires the provider SWAP label, one nonquote asset and an opposite quote flow; it remains a classification, not independent instruction-level verification. Opposite flows without that label are unverified candidates. Inflows without observed payment are kept separate. Complex trades and failed transactions are not silently counted as ordinary purchases.

SOL balance changes can include rent, account closure, tips and fees. Wrapped SOL and native SOL movements need reconciliation; net quote flows are not execution-price measurements. Transfers and opening inventory require tracing before realized returns can be computed. The 30-day retrieval does not reconstruct lifetime cost basis. USD market values in current metadata are not used as historical prices.

Historical volume and liquidity columns are deliberately empty. These must be joined from authenticated historical pool data at times strictly before each purchase. No entry-volume threshold or profitable trading strategy is validated. No orders or signing were enabled.

## Reproducibility

The raw provider records, coverage cursors and collection scripts were working data and are not kept in the repository.

The sample is the top five wallets on each captured board, not every wallet above $5,000. Remaining high-activity wallets and additional qualifying wallets need further bounded retrieval, plus historical market-state access.
