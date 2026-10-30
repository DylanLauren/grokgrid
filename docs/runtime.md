# GrokGrid runtime

> **Current state (2026-10-30):** house trading, the agent runner, the fee router and pump.fun Callouts are live; buy-and-burn waits for the official $GRID mint. See the README's [status table](../README.md#status-right-now) and [Going live with $GRID](../README.md#going-live-with-grid). The observer section below describes the original read-only observer, which still runs alongside the workers.

The current runtime is an **observer**, not an automatic trader. It cannot load
keys, build transactions, sign, buy, sell, distribute fees, or burn tokens.

`GET /api/runtime` and `GET /api/buyback` require the full `INGEST_TOKEN`.
Screen-only capabilities cannot read either route. The runtime route returns the
deployed public wallet identities and `VITE_MAIN_MINT`; the buyback route reads
finalized SOL balance and checks the configured mint on chain. RPC failure means
unknown, not zero. Neither route has a transaction execution method.

Run `node scripts/runtime-observer.mjs --once` or omit `--once` to observe every
30 seconds. Configure `observer-config.json` outside the checkout in
`~/.config/grokgrid/runtime/`, directory mode 700 and file mode 600:

```json
{
  "tokenFile": "/absolute/path/to/ingest-token-production",
  "rpcUrl": "https://solana-rpc.publicnode.com",
  "houseWallet": "PUBLIC_HOUSE_ADDRESS",
  "burnWallet": "PUBLIC_BURN_ADDRESS",
  "reserveLamports": "10000000",
  "thresholdLamports": "50000000"
}
```

Those reserve/threshold amounts are observation defaults, not approved trade
sizes. The worker writes a protected `observer-status.json` atomically, including
balances, balance changes, the pending launch queue and `signingEnabled: false`.
It pins house/burn identities to local configuration and refuses remote identity
changes. The first observed balance is a baseline; subsequent positive deltas
are funds detected, **not verified creator revenue**. Existing 20% proceeds are
already the burn share: do not multiply them by 20% a second time.

When the official mint is known, set `VITE_MAIN_MINT` in Vercel and redeploy.
The observer discovers it on its next poll and checks mint initialization and
mint/freeze authorities. This does not prove project identity by itself: the
operator must supply the official address. Missing/invalid mint blocks readiness.
Funding or setting a mint never enables execution.

The [offline house worker](trading-worker.md) now provides durable intents,
policy limits and opt-in read-only finalized-receipt reconciliation. These are
planning and observation facilities, not a live executor. Before enabling
automatic trading, complete independently verified position/risk accounting,
validated strategy inputs, executable exit handling, and a separately authorized
local signer with pre-broadcast durability and instruction validation. Before enabling buy-and-burn,
implement a fresh quote with bounded slippage, exact output reconciliation, and
an SPL burn of the acquired official token amount, with durable receipts and
ambiguous-result holds. Never retry a purchase after an unknown broadcast outcome
until its signature is reconciled. Burning means an SPL burn instruction, not a
transfer to an arbitrary address. No part of this observer performs those steps.

## Phone continuity

The cloud capture worker posts real frames while Grok's cloud computer is awake.
On October 28 it stopped producing frames during cloud idle suspension and
resumed with the same PID when Grok next ran a command. A background process
inside that suspended computer cannot provide a continuous feed. The website
correctly goes offline after stale frames, instead of showing invented activity.
An always-awake execution host is required for continuous capture. Do not label
a local pump.fun window as Grok's real trading screen unless Grok actually uses
that window. Screen capability expiry and process restart remain explicit
operational requirements; no paid keep-alive was enabled.

## Installing the launchd jobs

`ops/install-launchd.sh` (run it yourself) points every `fun.grokgrid.*` job at this checkout:
- the runtime observer, trading worker and phone renewal;
- new jobs for buy-and-burn (off), strategy (paper) and agent runner (paper);
- pump.fun Callouts and X posts, both off until enabled (see `docs/x-posts.md`).

Before it installs anything, it:
- runs the test suite;
- creates any missing config, all execution-off;
- **refuses to install** if any config would sign: trading not `observe-only`, buyback flags on, or runner/strategy not `paper`;
- runs one tick of each worker.

It backs up the old plists and prints the revert command (`ops/install-launchd.sh --revert <backup>`).

- `--check` runs everything except the install.
- `--apply-limits` writes the placeholder trading limits, still observe-only. It sets aside the trading journal only if the journal has no history.

The phone helper and keep-awake jobs are left as they are.

## Going live (dlao only)

`npx tsx ops/go-live.mjs <command>` from `~/coding/grokgrid-main`. Every command checks first, asks for a typed phrase, changes only its own config and prints the resulting state. It never runs by itself and never moves funds.

| Command | What it does | Refuses when |
|---|---|---|
| `status` | Shows every switch | — |
| `house` | Strategy `live` + house trading `execute` (dynamic allowlist, STOP file, house key) | The key isn't 0600 or doesn't match; the wallet holds less than one trade + reserve |
| `buyback <mint>` | Buy-and-burn on for the official mint (burn key) | The mint has a mint/freeze authority, is wrapped SOL, or the key doesn't match |
| `runner` | User agents sign through Privy | The Privy files aren't saved (0600), or `privy-setup` hasn't run |
| `callouts on\|off`, `x on\|off` | pump.fun Callouts / X posts | — |
| `stop` / `resume` | Freeze / unfreeze all signing | — |
| `exit` / `unexit` | Sell everything and stop buying | — |
| `off` | Everything back to observe-only / paper. It creates STOP first; a house with trade history stays frozen by STOP | — |

To add new launchd jobs later, re-run `ops/install-launchd.sh` **without** `--apply-limits` once the journal has history.

## RPC fallback

Every worker's Solana connection (`connect()` in `scripts/pump-chain.mjs`) uses the RPC URL from `observer-config.json` first. If a request fails there with a network error, timeout, HTTP 429 or a 5xx, the same request is retried once on a fallback endpoint:
- **Endpoint:** `GROKGRID_RPC_FALLBACK` when it is set to an https URL, otherwise Solana's public RPC.
- **Sends:** retrying a send re-sends the same signed transaction, which has the same signature, so it can't double-spend.
- **Not covered:** direct JSON-RPC fetches outside `connect()` (Helius DAS holder counts, the receipt verifier) still use the primary and fail closed as before.

## Worker logs

Each launchd job writes its stdout and stderr to `runtime/logs/<job>.log`. Workers print one line per run plus short error lines. Provider errors are redacted before logging (`scripts/log-safe.mjs`: URLs cut to their origin, `api-key` / token / secret / authorization values removed), and no worker prints keys, tokens or config contents.

- **Rotation:** `fun.grokgrid.log-rotate` runs hourly. A log over 5 MB is copied to `.1` (older copies shift to `.2` and `.3`) and then truncated in place, because launchd keeps the file open. It's user-level, so no root and no newsyslog.
- **Already-installed jobs:** `ops/apply-worker-logs.sh` points them at the log files and installs the rotation job, without the full installer, which refuses while trading is live.
  - It reloads only the jobs whose log paths change, and reloads the trading worker only when no sell is planned or in flight.
  - `--revert` points them back to `/dev/null`.
