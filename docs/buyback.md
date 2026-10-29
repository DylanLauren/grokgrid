# $GRID buy-and-burn worker

`scripts/buyback-worker.mjs --once` runs one tick. launchd runs it every 30 seconds from the Mac. **It ships off**: the default config can only read the chain and write `buyback-status.json`.

## What one cycle does

1. It reads the burn wallet's finalized SOL balance and the official mint. The mint must exist, be SPL or Token-2022, and have **no mint authority and no freeze authority**.
2. If the balance is at least the trigger, it spends `min(balance − reserve − fee allowance, max per cycle)` on $GRID. It buys on the pump.fun bonding curve, or on the canonical PumpSwap pool once the coin has graduated. Both are exact-out buys, and the quote is sized so the slippage ceiling lands on that amount. The buy is simulated before signing.
3. Once the buy is finalized, it burns **every** $GRID token in the burn wallet with an SPL `BurnChecked` (opcode 15). Total supply goes down on chain.

## Safety rules

- **Gates.** It signs only if all of these hold: `executionEnabled: true`, `signingEnabled: true`, the stop file is absent, `officialMint` is set and verified, and the keypair file is private (0600) and matches `burnWallet`. Any failed gate shows up in `blockers`.
- **Stop switch.** `touch ~/.config/grokgrid/runtime/STOP` (the `stopFile` path) halts any new signing on the next tick.
- **Journal before broadcast.** A signed transaction's signature and `lastValidBlockHeight` are fsync'd to `runtime/buyback/buyback-journal.json` before it is sent. Only one cycle can be open at a time.
- **No retry of unknown outcomes.** A leg stays held until it is finalized (success or error), or until its blockhash has passed with the signature never seen. Only then can that leg be planned again.
  - A failed or expired burn re-plans a burn of the real token balance.
  - A failed or expired buy closes the cycle.
  - A lock left behind by a crash needs an operator. It is never cleared automatically.
- **No key output.** The key is never logged or written anywhere. Status and error output never include the config, RPC URL or key.
- **Routes.** It buys on the bonding curve, or on the canonical SOL-quoted PumpSwap pool after graduation. A coin with neither reports `no-supported-route` and doesn't buy.

## Config (`~/.config/grokgrid/runtime/buyback-config.json`, mode 0600)

Values are the placeholder limits dlao is approving:

```json
{
  "version": 1,
  "executionEnabled": false,
  "signingEnabled": false,
  "burnWallet": "<VITE_BURN_WALLET>",
  "officialMint": null,
  "stopFile": "/Users/<you>/.config/grokgrid/runtime/STOP",
  "keypairFile": "/Users/<you>/.config/grokgrid/<burn keypair>.json",
  "triggerLamports": "50000000",
  "maxSpendLamports": "1000000000",
  "reserveLamports": "10000000",
  "feeAllowanceLamports": "3000000",
  "maxSlippageBps": 500
}
```

`burnWallet` must match `observer-config.json`, which supplies the RPC. Changing `officialMint` while a cycle is open is refused.

## Turning it on (dlao only)

1. Launch $GRID and set `officialMint` (also set `VITE_MAIN_MINT` in Vercel).
2. Run a tick with both flags off and check that `buyback-status.json` shows `mintVerified: true` and the expected blockers.
3. Set `keypairFile`, then `signingEnabled` and `executionEnabled` to true, and fund the burn wallet. Watch the first cycle reach `burned` on chain.

## Verified here (nothing signed or sent)

- A dry tick against mainnet with the default config ran clean.
- The unsigned buy for a live bonding-curve coin simulates OK with a funded payer.
- The unsigned buy for a live coin that has graduated to PumpSwap also simulates OK. A coin migrated elsewhere (not a PumpSwap pool) returns `no-supported-route`.
- The burn builds as Token / Token-2022 `BurnChecked` with one signer.
