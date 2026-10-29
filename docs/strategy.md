# Strategy engine (unvalidated)

`scripts/strategy-worker.mjs --once` runs one autonomous pass. **It defaults to paper mode.** Paper mode runs the whole loop (scan, screen, enter, exit) with simulated fills and keeps a private journal, so there are results to show before any real money moves. The status always says `strategyValidated: false`.

## Pipeline

1. **Candidates.** The latest pump.fun coins from DexScreener's profile and boost feeds.
2. **Market screen** (DexScreener pair data): pair age, liquidity, market cap, 5m and 24h volume, 5m buys and buy/sell ratio, and trade size as a share of liquidity.
3. **Chain screen** (RPC/Helius). This runs only for coins that passed step 2:
   - no mint authority and no freeze authority;
   - holder floor (Helius DAS);
   - top-10 holder share. Only this coin's own bonding curve and canonical PumpSwap pool are excluded; every other account counts, including program-owned ones;
   - creator share, summed across all of the creator's token accounts for the mint.
   Any missing fact fails the screen.
4. **Entry.** Among coins that pass, it ranks by buy/sell ratio × (5m volume / liquidity) and takes one entry per tick. A coin already held or already in flight is skipped. An approved coin goes on an **expiring allowlist** (`allowedMints: "dynamic"`). Buys need a live entry. Sells of a held position never do, so an exit can't be blocked.
5. **Exits** for each position. A sell's minimum comes from an **on-chain quote** on the same route the sell uses. If DexScreener's price differs from that quote by more than 15%, no sell is planned that tick. The exit rules: take-profit, stop-loss, a trailing stop armed after a gain, and max hold time. If the **exit file** (`exitFile`) exists, it sells everything and stops buying. The trading `stopFile` freezes all signing.

pump.fun's own APIs are behind a Cloudflare bot check. The engine does not use them.

## Defaults (hypotheses, not findings)

The 2026-10-28 research ([report](research/2026-10-28-report.md)) selected **no** thresholds. It warns about single-winner dependence and that win rate alone means little. Its one testable hypothesis is "limited-size entries in independently verified, liquid tokens with increasing genuine buyer activity". The defaults encode that hypothesis. Tune them in paper mode first.

| Setting | Default | Why |
|---|---|---|
| Pair age | 10 min – 24 h | Skips the first-minutes bot war and stale coins |
| Liquidity / market cap | ≥ $15k / $30k – $5M | Room to exit; research says size against liquidity |
| Volume 5m / 24h | ≥ $3k / $50k | Live interest, not one burst |
| 5m buys, buy/sell | ≥ 20, ≥ 1.2 | "Increasing genuine buyer activity" |
| Holders, top-10 share, creator share | ≥ 150, ≤ 30%, ≤ 5% | Concentration and dev-dump risk |
| Trade size | 0.05 SOL, ≤ 1% of liquidity, ≤ 3 open | Limited size |
| Take-profit / stop-loss | +60% / −25% | Asymmetric. A low win rate can still be net positive |
| Trailing stop | 20% off peak, armed at +25% | Keeps runners and protects gains |
| Max hold | 6 h | Memecoin interest decays |
| Paper fills | 3% slippage + 1.25% fee each side | Deliberately pessimistic |

## Config (`runtime/strategy-config.json`, 0600)

Take `DEFAULT_STRATEGY` from `scripts/strategy-policy.mjs`, then add `"exitFile": "/abs/path/EXIT"`. `mode: "paper"` is the default.

`mode: "live"` writes proposals into the trading journal through `planIntent`. It needs `allowedMints: "dynamic"` in `trading-config.json`. Nothing is signed unless the trading policy itself is in `execute` mode (see `trading-worker.md`). The trading policy's hard caps always apply on top of the strategy's settings.

Per-agent rules go through `tighten()`. They can only lower size, take-profit, stop-loss, hold time and open positions, or raise the liquidity and holder floors. They can never loosen a global setting.

## Heartbeats

The trading, buyback and strategy workers each `POST /api/ingest` once per tick:

```json
{ "type": "runtime", "worker": "trading|buyback|strategy|agent-runner|phone", "mode": "observe-only|paper|execute", "healthy": true, "agents": 0, "note": "<=80 chars" }
```

Posts are best effort and never include secrets. Set `GROKGRID_INGEST=off` to send nothing in tests and dry runs.

## Callouts and the live feed

- After a real trade reconciles, the trading worker posts it once as a `trade` event (`scripts/trading-callouts.mjs`). The site re-verifies the signature on chain and dedupes by signature. A private ledger (`trading-callouts.json`) records each signature.
  - A 4xx rejection is recorded and not retried.
  - An outage, 429 or 5xx is retried on the next tick.
- Each posted trade also writes one `action` line, for example "bought $X for 0.050 SOL · strategy unvalidated".
- Paper fills post as `action` lines prefixed **`paper:`**. They are never `trade` events, which need real signatures.

## pump.fun Callouts (house profile)

A pump.fun Callout push-notifies the profile's followers and counts on pump.fun's caller leaderboard. pump.fun allows one per 6 hours, and only for a coin the profile's wallet holds. The house profile is "GrokGrid" (the house wallet).

- **Route.** The house's logged-in pump.fun session in Chrome. AppleScript runs a script in an existing `https://pump.fun/` tab, so every request is same-origin with that session. The cookie/JWT never leaves Chrome; the script returns only a short result string.
  - It first calls `GET frontend-api-v3.pump.fun/callout/eligibility/{mint}`, the same call the page makes.
  - Outside a dry run it then calls `POST /callout/create` (multipart: `coinMint`, `thesis`).
- **Requirements.** Chrome > View > Developer > *Allow JavaScript from Apple Events*, and a normal pump.fun tab open in the house session. The script doesn't navigate, resize or move any window.
- **Which coin.** The newest reconciled **real** buy that the house still holds. Paper fills never reach this.
- **Limits.** At most one call per 6 hours, no repeat of a signature or of a coin within 24 hours, and a private ledger `pump-callouts.json`. It's off unless `callout-config.json` has `"pumpCalloutsEnabled": true`.
- **Dry run.** `node scripts/pump-callout-worker.mjs --dry-run [--mint <mint>]` asks for eligibility and stops before create.
  - On 2026-10-29 a dry run for FLOATER returned `verdict-INSUFFICIENT_BALANCE`: the house holds nothing yet, so pump.fun's own gate works as expected.
  - The verdict string pump.fun returns for an allowed call hasn't been seen yet. The worker accepts `OK`, `ELIGIBLE` or `ALLOWED` and fails closed on anything else. Check it with a dry run on a held coin before enabling.
