# Agent runner

`scripts/agent-runner.mjs --once` runs every launched Grok bot for one tick. launchd runs it every 45 seconds. It ships in paper mode; it runs in **execute** mode now (`go-live.mjs runner`). The strategy is unvalidated, and the status says so.

## Where agents come from

- Confirmed launches come from the durable outbox (`GET /api/launch/events`, full ingest token). The runner keeps its own cursor in `agent-runner-state.json`.
- Rules come from the registry (`/api/agents`) through `normalizeLaunchPolicy`: `maxSol`, `takeProfit`, `stopLoss` and an optional `style` (`early` | `momentum` | `steady`). `style` is added to the pinned policy only when present, so bots launched before styles keep their policy hash. They're pinned on first sight. If a later change appears, the agent is marked `rules-changed-review` and stops trading. The change is never adopted silently.
- Each agent trades from its own trading wallet (a Privy wallet tied to its owner's Phantom login), with its own journal in `runtime/agents/<id>/`. Funds are never shared between agents.
- A slow or failed read of the launch outbox doesn't stop the tick: known bots keep trading, the cursor stays put and it's retried next tick. Only four failures in a row mark the runner unhealthy (which closes launches).

## Caps

`agent-runner-config.json` (0600) holds the global caps. An agent's `maxSol` can only lower the per-trade cap, and its take-profit and stop-loss can only tighten its style's (`tighten()`). Current caps: 0.05 SOL per trade (also the Privy signer's per-buy cap), 0.15 SOL open exposure, 0.125 SOL daily loss, 0.02 SOL reserve, 15% slippage. Shape:

```json
{ "version": 1, "mode": "paper", "stopFile": "/abs/STOP", "exitFile": "/abs/EXIT", "maxAgents": 100, "concurrency": 6,
  "privyServerFile": "/abs/privy-server.json", "privyAuthorizationKeyFile": "/abs/privy-authorization.key",
  "caps": { "maxTradeLamports": "50000000", "maxExposureLamports": "150000000", "maxDailyLossLamports": "125000000",
            "reserveLamports": "20000000", "maxSlippageBps": 1500 } }
```

`caps.maxTotalLossLamports` (optional) gives each agent the same lifetime realised-loss stop as the house (see the trading worker doc). `concurrency` (1–16, default 6) is how many agents run at once. They share one market read per tick; each keeps its own wallet, journal and directory, and one agent's error never stops the others.

## Execute mode

An agent signs only if all of these hold: `mode: "execute"`, the launch carries a Privy `privyWalletId`, and the stop file is absent. Without a wallet id it reports `awaiting-wallet-id`.

- **Signing** goes through `wallets().solana().signTransaction(walletId, …)` with the policy-scoped authorization key and an idempotency key derived from the message hash.
  - The fee payer must be the agent's wallet.
  - Privy must return the identical message, or the signature is refused.
- **Journal before broadcast and settling** work as in the house executor (`trading-worker.md`): one transaction in flight per agent, only a passed blockhash with the signature never seen counts as dropped, and sell floors come from on-chain quotes.
- **Secret files.** `privy-server.json` holds `{appId, appSecret}` and `privy-authorization.key` holds the P-256 authorization key. Both are 0600. Neither is ever logged or written to status. dlao supplies the values.
- **Callouts.** Each reconciled trade is posted as that agent's callout (per-agent ledger).

## What it buys: styles on the bonding curve

A user bot's signer can only buy on pump.fun's bonding curve, so the runner scans curve coins: DexScreener's profile and boost feeds plus its pump.fun pair search. Each bot judges them with the **curve screen** for its **style** (`STYLES` in `scripts/strategy-policy.mjs`; no style means `steady`):

| Style | Screen | Exits: TP / SL / trail arm / trail / max hold | Ranks by |
|---|---|---|---|
| early | mc $10k–30k, age 3–20 min, ≥ 40 holders, buy/sell ≥ 1.3, ≥ 12 buys in 5m | 35% / 15% / 15% / 12% / 60 min | youngest with strong buys |
| momentum | mc $20k–65k, age ≥ 5 min, ≥ 60 holders, buy/sell ≥ 1.5, 5m change +5% to +25%, ≥ $2k 5m volume | 45% / 20% / 20% / 15% / 120 min | 5m change × buy/sell |
| steady | mc $30k–65k, age ≥ 30 min, ≥ 100 holders, buy/sell ≥ 1.2, 1h change > 0 | 60% / 25% / 25% / 20% / 360 min | holders + a calm rising hour |

Every style keeps the house's rug checks (no mint or freeze authority, top 10 ≤ 30%, dev ≤ 5%, no +25% 5m chase), needs at least 5 SOL in the curve (a buy must stay within 1% of it), and keeps every money limit. Trade size follows `trade-budget.mjs` like the house's, from the bot's own balance and its 80% fee share.

## Fast exits

The exit watcher (`scripts/exit-watcher.mjs`, always running) checks every bot whose journal shows a coin held every 5 seconds: its wallet's finalized positions, on-chain sell quotes, and its own style's exit rules through `livePlan` (sells only). Two checks in a row must agree. A confirmed sell is planned into that bot's journal, and the agent runner is started at once to sign it through the bot's Privy signer. Idle bots cost no reads. If the watcher holds a bot's journal for a moment, the runner reports that bot as `busy`, not as an error.

## Heartbeat

Every tick posts `{type:"runtime", worker:"agent-runner", mode:"paper"|"execute", healthy, agents:<running>}`. The site opens launches only when this beat is healthy in execute mode **and** `LAUNCHES_ENABLED=1` is set in Vercel. They close again while the grid is full: registered bots at or above `AGENT_CAP` (Vercel env, default 100; keep it equal to the runner's `maxAgents`).
