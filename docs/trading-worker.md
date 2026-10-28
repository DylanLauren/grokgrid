# House worker: offline planning and observation

This worker is an offline foundation, **not a live trader**. It reads the existing
house observer, maintains a durable intent journal, and can evaluate hypothetical
buy and sell proposals. Its optional receipt adapter makes read-only RPC queries. It has no market strategy,
key loader, signer, swap builder, broadcast transport, or automatic agent-launch consumer. No configuration
can enable execution. The CLI does not simulate fills or claim a trade occurred.

## Run the observer

Create `trading-config.json` in the existing protected runtime directory
(`~/.config/grokgrid/runtime`, or `GROKGRID_RUNTIME_DIR`). Use mode 600. Example:

```json
{
  "version": 1,
  "mode": "observe-only",
  "executionEnabled": false,
  "signingEnabled": false,
  "agentId": "house",
  "wallet": "GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT",
  "allowedMints": [],
  "maxTradeLamports": "1000000",
  "maxExposureLamports": "1000000",
  "maxDailyLossLamports": "1000000",
  "reserveLamports": "10000000",
  "maxSlippageBps": 100,
  "maxPendingIntents": 1,
  "maxIntentAgeMs": 60000
}
```

These numbers are illustrative offline limits, not approved spending amounts.
The empty allowlist rejects every proposed token. Never use this example as
live trading authorization.

```sh
node scripts/trading-worker.mjs --once
```

Omit `--once` to observe every 30 seconds. The process reads public information
from `observer-status.json` and writes `trading-status.json`. It reads no ingest
credential or wallet secret. Status is `observing-execution-disabled` only when
the pinned house observer is healthy, execution-disabled and at most 90 seconds
old. It reports queued launch count without consuming or acknowledging launches.
Missing, changed, stale or future observations are unavailable, not zero balance.

The protected `trading/` directory contains `trading-journal.json`, an integrity
checksum and monotonic revision. Writes use an exclusive lock, temporary file,
file sync, atomic rename and directory sync. Corrupt data or changed policy/wallet
fails closed rather than resetting state. A crash may leave `trading.lock`; do
not remove it until no worker owns it and the journal and any external submission
have been investigated. Automatic stale-lock takeover is intentionally absent.

## Hypothetical proposals

`--proposal /absolute/path/to/proposal.json` processes one offline proposal and
exits. Every proposal needs a unique `id`, pinned `agentId`, `wallet`, allowlisted
`mint`, integer `slippageBps`, and millisecond `createdAt`/`expiresAt`.
A buy adds `side: "buy"` and integer-string `spendLamports`. It requires a local `trading-risk.json`
with `wallet`, `complete: true`, integer-string `exposureLamports` and
`dailyLossLamports`, current `utcDay` and millisecond `observedAt`.

Risk inputs are **operator/test-supplied assertions**, not an implemented chain
accounting service. The worker validates identity, completeness flag and freshness;
it does not prove their financial accuracy. Do not use this interface for live
spending. Missing risk data blocks proposals; the ordinary observer needs none.

Policy evaluation counts pending reservations against available SOL and exposure,
retains a SOL reserve, checks daily loss, and rejects excess size/slippage, expired
proposals, unknown mints and wallet changes. Idempotent repeated input returns the
same record; reuse of an ID with different input fails. An accepted hypothetical
proposal is always `blocked-execution-disabled`. It does not reserve on-chain
funds. Unsubmitted proposals can expire, releasing only this local reservation.

## Sell planning from actual positions

A sell adds `side: "sell"`, positive integer-string `tokenUnits`, integer
`tokenDecimals`, and a positive integer-string `minimumReceiveLamports`. The CLI
independently queries both SPL token programs at finalized commitment for each
sell proposal. It never trusts a cached or caller-provided inventory file to plan
an exit. `--refresh-positions --once` performs just that read-only collection and
writes `trading-positions.json`; provider failure writes `complete: false`, never
fabricated zero inventory. Cost basis is always marked unverified.

The policy requires a complete, fresh, wallet-matched snapshot, matching decimals,
and enough spendable raw token units after same-mint pending sell reservations.
The snapshot's finalized context slots must not predate any reconciled successful
receipt. This prevents reusing old inventory after an earlier sale. No exposure or
profit is inferred from a proposed or confirmed sell. Sell planning does not need
invented cost basis/daily loss, and buy loss/exposure caps do not block an otherwise
valid risk-reducing exit. Wallet SOL reserve and pending-intent limits still apply.

Frozen, delegated, native or extension-bearing token accounts remain unavailable
for selling. **All Token-2022 balances are recorded with zero spendable units**
until mint-level transfer restrictions/extensions are independently inspected.
This is a deliberate compatibility limit, not a claim those balances are zero.
Only supported ordinary SPL-token balances can currently produce offline sell
intents. Wrapped SOL is not accepted as a trade mint.

Sell reconciliation requires the exact intended token debit and real SOL proceeds
at least equal to the proposed minimum, net of network fee and owned-account rent
adjustments. Partial fills or other-quote proceeds remain held for review. The
minimum is an offline proposal constraint, not a validated quote or profit target.
No transaction is built, signed, or sent.

## Ambiguous outcomes and read-only reconciliation

The library has `holdExternalSubmission` for recording a signature that a future
separate integration already knows. It does not submit transactions. A recorded
signature is immutable and cannot belong to two intents. The resulting
`held-ambiguous` state blocks further proposals and does not expire or retry.

`reconcileHeldIntent` accepts a read-only verifier. The CLI option `--reconcile`
wires the native `trading-reconcile.mjs` adapter to the existing private
`observer-config.json` RPC URL, only when held signatures exist. The configured
house wallet must match the pinned policy. It independently requests
`getSignatureStatuses` with historical search and `getTransaction` at finalized
commitment. It checks matching finalized slots, the immutable signature, signed
wallet, target mint, intent time window, exact SOL balance spend (network fee and
owned token-account rent removed), and positive received token units. It rejects
other owned nonquote-token balance changes, ownership changes and malformed data.
Provider credentials stay internal; raw responses/errors are never logged.
Use `node scripts/trading-worker.mjs --once --reconcile` for one pass.
Absent, uncertain, failed-request or mismatched evidence leaves the hold intact.
Matching finalized evidence resolves to `reconciled-confirmed` or
`reconciled-failed`. A confirmed result verifies wallet balance movements; it does
not decode swap instructions, prove cost basis, or rule out unrelated transfers
within the same transaction. This adapter therefore does not complete trading
accounting or authorize orders. Test fixtures exercise the contract; they are not
on-chain trade evidence. Caller-supplied receipts alone must never be treated as
verified chain data in a future integration. Buy confirmation requires exact planned spend; sell confirmation requires exact
planned token units and the minimum SOL proceeds. Different fill semantics remain
held until explicitly reconciled, not relaxed silently. Finalized receipt slots
are retained with the journal evidence.

## Remaining live-work prerequisites

- A validated strategy and independent market/position accounting, including
  transfer-origin inventory, fees, open positions and daily realized losses.
- Instruction-level swap verification and reconciliation of accounting snapshots
  with all completed and pending orders so neither can be double-counted or lost.
  The implemented read-only adapter verifies balance movements only.
- A separately authorized signer/transport, durable recording before broadcast,
  fresh quote and instruction validation, enforced authorized limits and stop switch.
- Live sell/exit transaction building, quotes, Token-2022 mint-extension support,
  and verified accounting/exposure release. Offline sell proposals and balance-flow
  reconciliation do not implement these execution functions.
- Proven agent-launch assignment and per-agent execution, with isolated journals
  and wallet/rule bindings. The house observer does not consume that queue.

Only after these are built and verified should activation be considered. The
existing no-trade/no-signing instruction remains enforced by this implementation.

## Local runtime protections

The CLI requires an owned private runtime directory and regular owned private
input files, opened with symlink following disabled. Status and position writes
use unique exclusive temporary files and atomic rename. A competing journal writer
leaves the prior status untouched rather than replacing a healthy worker status
with a lock-contention failure. SIGINT/SIGTERM interrupt the polling delay; an
in-progress read-only RPC remains bounded by its request timeout.
