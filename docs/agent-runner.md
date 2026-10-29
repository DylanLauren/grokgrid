# Agent runner

`scripts/agent-runner.mjs --once` runs every launched Grok bot for one tick. launchd runs it on an interval. **It defaults to paper mode.** The strategy is unvalidated, and the status says so.

## Where agents come from

- Confirmed launches come from the durable outbox (`GET /api/launch/events`, full ingest token). The runner keeps its own cursor in `agent-runner-state.json`.
- Rules come from the registry (`/api/agents`) through `normalizeLaunchPolicy`: `maxSol`, `takeProfit` and `stopLoss`. They're pinned on first sight. If a later change appears, the agent is marked `rules-changed-review` and stops trading. The change is never adopted silently.
- Each agent trades from its own launcher wallet, with its own journal in `runtime/agents/<id>/`. Funds are never shared between agents.

## Caps

`agent-runner-config.json` (0600) holds the global caps. An agent's `maxSol` can only lower the per-trade cap, and its take-profit and stop-loss can only tighten the strategy (`tighten()`). These are the placeholder caps dlao is approving:

```json
{ "version": 1, "mode": "paper", "stopFile": "/abs/STOP", "exitFile": "/abs/EXIT", "maxAgents": 50,
  "privyServerFile": "/abs/privy-server.json", "privyAuthorizationKeyFile": "/abs/privy-authorization.key",
  "caps": { "maxTradeLamports": "50000000", "maxExposureLamports": "500000000", "maxDailyLossLamports": "250000000",
            "reserveLamports": "20000000", "maxSlippageBps": 1500 } }
```

## Execute mode

An agent signs only if all of these hold: `mode: "execute"`, the launch carries a Privy `privyWalletId`, and the stop file is absent. Without a wallet id it reports `awaiting-wallet-id`.

- **Signing** goes through `wallets().solana().signTransaction(walletId, …)` with the policy-scoped authorization key and an idempotency key derived from the message hash.
  - The fee payer must be the agent's wallet.
  - Privy must return the identical message, or the signature is refused.
- **Journal before broadcast and settling** work as in the house executor (`trading-worker.md`): one transaction in flight per agent, only a passed blockhash with the signature never seen counts as dropped, and sell floors come from on-chain quotes.
- **Secret files.** `privy-server.json` holds `{appId, appSecret}` and `privy-authorization.key` holds the P-256 authorization key. Both are 0600. Neither is ever logged or written to status. dlao supplies the values.
- **Callouts.** Each reconciled trade is posted as that agent's callout (per-agent ledger).

## Heartbeat

Every tick posts `{type:"runtime", worker:"agent-runner", mode:"paper"|"execute", healthy, agents:<running>}`. The site opens launches only when this beat is healthy in execute mode **and** `LAUNCHES_ENABLED=1` is set in Vercel. They close again while the grid is full: registered bots at or above `AGENT_CAP` (Vercel env, default 100; keep it equal to the runner's `maxAgents`).
