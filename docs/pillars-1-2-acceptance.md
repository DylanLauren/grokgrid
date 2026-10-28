# Pillars 1–2: evidence and acceptance

Audit date: October 28, 2026. Scope is the real phone feed and the house worker.
No purchase, signature, trade, coin launch, credential inspection, or production
mutation was performed for this audit. This document distinguishes local checks
from actual production/runtime acceptance.

## Public production snapshot before this change

- `/api/live`: HTTP 200, `screenTs: 0`, zero actions.
- `/api/screen`: HTTP 404 with `Cache-Control: no-store`.
- `/api/launch/status`: HTTP 200, `open: false`, zero free wallets. The then-deployed
  wording promised reopening in a few minutes, without a running executor.
- `/api/runtime` without authorization: HTTP 401.

These observations prove that production was offline/closed at the observation
time. They do not prove stream continuity, wallet control, or execution readiness.

## Pillar 1: real phone

Local code must pass:

1. Capture an explicitly selected application/window and check its identity and
   content boundary before and after capture. Reject window/tab/geometry changes,
   minimized or missing windows, and credential expiry. Never fall back to the
   full desktop or a different active application.
2. Use a screen-only capability with expiration. It cannot read the wallet queue,
   change agents, or submit trade events. Never log the capability or raw network
   errors containing URLs or credentials.
3. Store JPEG and timestamp atomically. The public read must return the requested
   timestamp's frame, or fail closed when that version has been replaced. No
   cached old frame should remain labeled current after expiry.
4. Show offline when frame age exceeds 12 seconds, a requested frame fails, or
   capture stops. WHEP, if later configured, also needs connection timeouts and a
   video-frame progress watchdog; a single `playing` event is insufficient.
5. Stop or back off on authorization rejection, missing capture permissions,
   network failures and rate limits. Restart must use the same pinned target.

Runtime acceptance still required:

- Grok actually operates the selected browser/window. A pump.fun page opened by
  another process is not evidence of the bot's screen.
- Parent/operator verifies that the published content contains only the intended
  work surface. Then exercise fresh frames, wrong-tab rejection, disconnect,
  process restart and credential-expiry behavior against the real endpoint.
- Observe continuity during idle periods. The cloud computer was previously
  observed suspending while idle; capture code cannot overcome host suspension.
  A Mac deployment is continuous only while its user session and host are awake.
- A dedicated real working window and adequate screen-recording access are needed;
  an app install or permission grant alone does not establish screen continuity.

## Pillar 2: house worker

Local code must pass:

1. Pin public wallet identity and reject policy drift, stale observations,
   unsupported assets, and missing policy/risk data.
2. Use integer token/SOL accounting, durable order-intent IDs, one writer, restart
   recovery, expiry, per-order/exposure/loss limits and an explicit stop control.
3. Never treat timeout after a broadcast as a failed order. Hold unknown results
   until matching finalized receipt reconciliation; do not create a second order.
4. Separate observation/proposal from signing and execution. No funds, mint update,
   queue event, or screen activity may enable execution by itself.
5. Persist trade events idempotently using wallet, transaction signature and mint.
   Require finalized wallet/mint/direction balance evidence. Preserve exact raw
   amounts. Caller-reported USD numbers cannot increment wins or realized PnL.
6. Distinguish balance-flow evidence from decoded execution price and historical
   cost basis. The receipt handler's `verification: wallet-balance-movements`
   does not prove realized profit or identify every instruction as a swap.

Implemented receipt boundary:

- Reject missing, failed or unfinalized receipts, wrong signer/mint/direction,
  unsupported quote-only flows and ambiguous multiple nonquote asset movements.
- Adjust owned SOL account movement for network fee and owned token-account rent.
  Native/WSOL balance movement is not necessarily the isolated pool price: tips or
  other same-transaction transfers can affect it. USDC/other quote trading is not
  supported by this ingestion verifier yet and must fail closed.
- Save observed sizes from chain; historical USD metrics remain null and
  `accountingVerified: false`. UI must display unavailable, not zero profit.
- Lua dedupe and event/stat update run together, so ordinary retries do not count
  twice. Key types and counter format are checked before mutations because Redis
  Lua does not roll back runtime command errors. No reported `pnlUsd` can update
  wins or realized PnL.

The local worker now also has an opt-in read-only finalized receipt reconciler.
It checks independent status/transaction responses, signature, slot, wallet, mint,
intent validity interval and exact observed SOL movement. Unknown/mismatched
results stay held. This is tested with mocked RPC; no live order was reconciled.

Runtime acceptance still required:

- A separately authorized signer/executor and approved trading limits. Current
  observe-only/proposal tests deliberately provide no evidence of real execution.
- A validated strategy input source, funded wallet and operator-controlled
  activation. Research leaderboard cash flows are not a validated strategy.
- Reconcile at least one explicitly authorized real order end to end before
  calling this a live trading product; this audit does not authorize that order.
- Verify actual restart, cancellation, RPC outage and unknown-submission recovery
  using the production runtime. Mock tests alone cannot establish production
  signing, route availability or fill accuracy.

## Adjacent launch integration that must stay gated

A wallet pool is not executor readiness. Launching must stay paused until assigned
wallets have actual worker/signer ownership, durable launch acknowledgement and
rule enforcement. `/api/ingest` currently returns a rolling latest-launch list,
not an acknowledged task queue; a worker must not forget launches outside that
window or start duplicates after restart. An agent's `maxSol`, `takeProfit` and
`stopLoss` are recorded configuration, not proof of enforced orders.

The public feed's legacy fees/burn totals and wallet-history samples are still
reported ingestion data; they need their own receipt-backed accounting before
being described as verified burn/fee performance. This is separate from the
first two pillars and is not repaired by the trade receipt checks.

## Verification performed

- Baseline suite before changes: 21 tests passed.
- Five added trade receipt tests cover wallet/mint/side, network-fee and ATA-rent
  handling, closed token accounts, duplicate retries, ignoring inflated reported
  PnL, unavailable finalized receipts and store-type preflight rejection.
- API TypeScript check passed after receipt-handler changes.
- Combined suite with concurrent worker/phone changes: 54 tests passed at audit.
  Parent should rerun after final integration and verify deployed behavior.

## Restart and privacy follow-up

A dedicated bot-only working window remains necessary. Checking the same window,
URL and geometry before/after capture catches ordinary changes but cannot prove
that a tab did not switch away and back entirely within that interval. The
configuration marker `grok-bot-actual-window` is an operator assertion; actual bot
use must be demonstrated. A window-ID capture avoids a full-desktop fallback.

Abrupt process termination can leave a private screenshot temp directory or a
capture/journal lock. Restart recovery must identify the previous process, inspect
state, and clean only that worker's obsolete artifacts. Never automatically delete
an ambiguous trading hold. The current offline worker performs no broadcasts, so
recovery tests must not be described as evidence of real order recovery.

Review before continuous operation: private runtime root and config inputs,
exclusive/unique status temp files, competing invocation behavior, explicit stop
status, and signal responsiveness. An unavailable status should not overwrite a
healthy writer solely because a second process could not obtain its lock. These
are operational checks that can be completed without enabling spending. The
follow-up below records the checks since implemented.

## Offline sell and position review

The house worker now supports hypothetical exit proposals, still blocked from
execution. The CLI queries both SPL token programs at finalized commitment and
records exact raw inventory, decimals, source context slots and
`costBasisVerified: false`. No token market price, acquisition cost, PnL or strategy
result is inferred from balances. Failed/incomplete RPC results are unavailable,
not zero holdings.

A sell proposal requires fresh complete positions, matching mint/decimals, exact
units, positive minimum SOL proceeds and sufficient nonreserved inventory. Pending
same-mint exits reserve local units; ambiguous submissions keep the hold, and
proposing an exit does not release exposure. A daily buy-loss limit does not block
an otherwise valid risk-reducing exit. Exact finalized sell units and minimum SOL
movement are required before reconciliation. A new position snapshot may not
predate a confirmed intent's slot.

Frozen, delegated, native and account-extension inventory is excluded from
spendable units. Token-2022 also requires mint-extension review: an empty token
account extension list alone does not prove absence of transfer hooks, transfer
fees or other mint-level restrictions. The implementation now reports all Token-2022 balances with zero spendable
units until mint-extension review is implemented; a regression test checks this.

The runtime input reader now checks private owned regular files with
`O_NOFOLLOW`, the runtime root is checked, and status outputs use unique exclusive
temporary files and atomic rename. Signal waiting is abortable. Lock contention now uses an explicit error code and leaves another healthy
writer's status untouched; the focused CLI test verifies that behavior.

Follow-up validation: 24 focused worker, reconciler and offline-sell tests passed,
including Token-2022 exclusion, pre-receipt snapshot rejection and lock-status
preservation. These tests use fixtures, not live trades.
