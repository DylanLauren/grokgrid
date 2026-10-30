# Creator-fee distributor

Every GrokGrid coin is created with a pump.fun fee-sharing config:
- **Bot coins:** 80% to the bot's wallet, 20% to the $GRID burn wallet.
- **$GRID:** 80% to the house treasury, 20% to buy-and-burn.

pump.fun keeps the fees in the coin's creator vault until someone sends its permissionless sweep and distribute instructions. `scripts/fee-distributor.mjs` sends them, so the split actually pays out.

## What one run does

1. It lists the coins: the official `$GRID` mint (`buyback-config.json`) plus every bot coin in `/api/agents`.
2. For each coin it asks the program how much is distributable (`getMinimumDistributableFee`). It skips a coin that has no fee sharing, is under the program minimum, is under `minDistributeLamports` (0.01 SOL), or was sent within `retryMinutes`.
3. It builds the SDK's sweep + distribute instructions. Only pump.fun, PumpSwap, pump fees and compute-budget programs are allowed.
4. It simulates the transaction and checks the house wallet loses no more than `maxFeeLamports`. The house pays the network fee and nothing else.
5. When enabled, it signs with the house key, records the signature, then broadcasts. It cannot change who is paid: the program pays the on-chain shareholders.

## Running it

- **launchd:** runs it every 10 minutes. It ships **off** (while off it only reports `dry-run-would-distribute` in `runtime/fee-distributor-status.json`); it is **on** now and paying out every bot coin.
- **Turn on:** `npx tsx ops/go-live.mjs fees on`. **Turn off:** `fees off`. The house STOP file also halts it.
- **Check one coin:** `node scripts/fee-distributor.mjs --probe <mint>` builds and simulates without signing.

## Lifetime fees for the matrix

After routing, each run posts every coin's **lifetime creator fees** (`{type:"fees", agent, feesSol}`, only when the value changes). The matrix, bot pages and Stats all read that one number (`gg:stats:<id>.feesSol`).

- **Paid out so far:** the sum of pump.fun's `DistributeCreatorFeesEvent.distributed` for that coin. Only events the pump program itself emitted (Anchor self-CPI, program resolved against account and lookup-table keys) count, and only when the burn wallet is one of the event's shareholders, which means GrokGrid coins only. Log lines are ignored, since any program can print one.
- **Found through the burn wallet's history:** it is a shareholder of every GrokGrid coin, so every payout touches it and trades don't. One running tally (`fee-distributor-state.json` → `feeTally`) reads at most 200 transactions per run, oldest first; a backlog is walked down across runs and the cursor never skips anything unread. Totals post only once fully caught up.
- **Waiting to be paid out:** `getMinimumDistributableFee().distributableFees`, read after the tally so nothing counts twice.
- These are total creator fees (80% + 20%). $GRID's appear on the house row once `officialMint` is set.

## Config (`runtime/fee-distributor-config.json`, optional)

```json
{ "version": 1, "enabled": false, "minDistributeLamports": "10000000", "maxFeeLamports": "200000", "retryMinutes": 30 }
```
