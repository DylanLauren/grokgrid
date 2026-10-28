# GrokGrid runtime

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

Before enabling automatic trading, implement durable order intents, confirmed
receipt reconciliation, per-agent limits, daily loss limits, validated strategy
inputs, and a separately authorized local signer. Before enabling buy-and-burn,
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
