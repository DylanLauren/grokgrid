# User-owned agent wallets

The selected model creates a user-owned Privy Solana wallet **before** launch. That same address is the coin creator/developer and the agent's trading wallet. An external Phantom wallet may fund it; connecting Phantom does not authorize unattended transactions from Phantom's address.

This document describes the integration contract and research, not a completed live trading acceptance. No wallet creation, delegation, signature, coin launch or trade was performed by these tests.

## SDK and browser contract

Verified against current official documentation and installed React package types on 2026-10-28:

- `@privy-io/react-auth` 3.51.0: `PrivyProvider`, `usePrivy`, `useSigners` from the root package; `useCreateWallet`, `useWallets`, `defaultSolanaRpcsPlugin` from `/solana`.
- `@privy-io/node` 0.37.0 is the selected server SDK. The server adapter must use its actual resource schemas; the normalized verifier intentionally does not guess SDK owner fields.
- `usePrivy().getAccessToken()` provides the session token for the server request. Authentication must finish before wallet creation or authorization.
- `useCreateWallet().createWallet()` creates the first Solana embedded wallet. The installed shared creation implementation supports `createAdditional: true` for another wallet of the selected chain. In TEE mode it rejects explicit HD `walletIndex` and directs callers to `createAdditional` instead. Provider quotas still apply; this is not a promise of unlimited wallets or signatures.
- `useSigners().addSigners({ address, signers: [{ signerId, policyIds: [policyId] }] })` asks the owner to authorize the configured additional signer. The `signerId` is a key-quorum ID. Never omit the policy array: the provider documents that omission applies no policies. One override policy per signer is currently supported.
- `useSigners().removeSigners({ address })` removes **all** additional signers on that embedded wallet. Recheck readiness after adding or removing a signer.

Keep automatic wallet creation off until the user explicitly requests it. Do not combine wallet creation with an unverified signer grant. Display the current server-approved policy summary before the user chooses authorization. Immediately before adding a signer, refresh server readiness and require returned signer/policy IDs to match the public configuration; stale public build settings must not authorize a different grant.

Public configuration names:

```text
VITE_PRIVY_APP_ID
VITE_PRIVY_AGENT_SIGNER_ID
VITE_PRIVY_AGENT_POLICY_ID
```

Server configuration names (values are never browser configuration):

```text
PRIVY_APP_ID
PRIVY_APP_SECRET
PRIVY_AGENT_SIGNER_ID
PRIVY_AGENT_POLICY_ID
PRIVY_AGENT_POLICY_SHA256
PRIVY_AGENT_POLICY_SUMMARY
PRIVY_AGENT_SIGNER_PUBLIC_KEY
PRIVY_AUTHORIZATION_PRIVATE_KEY
```

The authorization key is a separate P-256 request-authorization key, not the user's Solana wallet private key. Store it only in protected server/local worker secret storage. Reuse neither another project's app credentials nor its signer. The app secret and authorization key must never use a `VITE_` prefix.

## Read-only server readiness

The recommended route is `POST /api/agent-wallet/readiness` with a Privy access token in the Bearer header and `{ walletId, address }` in the body. Return `Cache-Control: no-store`; never log the authorization header or raw SDK errors.

`api/_privy-readiness.ts` exports `verifyPrivyWalletReadiness` with dependency-injected server resource reads. Its provider interface is a **normalized adapter contract**, not a claim that raw SDK responses have these exact fields. In installed Node 0.37.0, the service method takes a string (the lower-level library helper takes an object). The adapter must verify the JWT using `privy.utils().auth().verifyAccessToken(accessToken)`, retrieve the authenticated user, retrieve the requested wallet and its actual owner, then retrieve the configured policy. Raw `wallet.owner_id` identifies an owner key quorum, not a user DID. Resolve that quorum and require threshold 1, exactly the authenticated user, no authorization keys and no nested quorums. Separately resolve the agent signer quorum and require threshold 1, the configured public authorization key only, no users and no nested quorums. It must establish a user owner DID from this authoritative provider ownership data; a linked account alone is insufficient. Never construct provider evidence from request JSON or a client `delegated` flag.

The verifier requires:

1. Verified issuer `privy.io`, matching app ID, unexpired token and a Privy user DID.
2. Exactly one matching linked **Privy embedded Solana** wallet and a fresh wallet resource with the same ID/address/chain and verified owner DID.
3. The independently reviewed policy ID, Solana chain, version and canonical rules fingerprint. The fingerprint covers `{ version, chain_type, rules, owner_id }`, sorts object keys and preserves array order. A policy owner must be present; changing it invalidates the fingerprint. Never automatically trust the current policy by populating the configured fingerprint from the same readiness request. External condition-set contents or other mutable policy dependencies require separate review/pinning; the initial policy should use fixed reviewed conditions.
4. Either no additional signer yet, or exactly the configured signer with exactly the configured nonempty override policy. Unknown, extra or unscoped grants fail closed.

After ownership and the approved policy are verified, the response has `canAuthorize: true`, the approved `policySummary`, `policySha256`, `signerId`, `policyId`, wallet/user identifiers and `checkedAt`. With no signer, `reason` is `delegation-required` and `walletAuthorizationReady` is false. With the exact grant, the reason is `authorization-verified` and wallet authorization is true. Failure responses have `canAuthorize: false` and contain only a sanitized reason.

**Every response keeps `executionEnabled: false`.** This proves a wallet grant, not server key possession, funding, successful quotes/simulation, risk accounting, strategy quality or a live worker. Do not use this flag alone to turn on trading. Revocation must be rechecked before every signing request; a successful readiness response is a snapshot, not durable authority.

## Policy construction constraints

Official Solana policy examples support System Program transfer amounts and recipients, SPL transfer amounts/mints, time windows and decoded Anchor instruction arguments/accounts. For Pump trades, a System Program transfer cap alone does not constrain SOL spent by a Pump program through CPI. Decode the reviewed Pump buy/sell instructions and constrain their maximum-input/minimum-output arguments and relevant accounts.

- Pair every `solana_instruction_data` IDL condition with the exact `solana_program_instruction.programId` condition **in the same rule**. The IDL `address` field is ignored, and discriminators are not unique across unrelated programs.
- Maximum IDL size is 32 KB each and 128 KB across the policy. Trim complete instructions with their ordered accounts and referenced types.
- Broad ALLOW rules can override narrower ALLOW restrictions. Do not allow a whole program in a separate rule that bypasses its amount limits. Do not permit unrestricted message signing or key export for the worker signer.
- Address Lookup Table addresses cannot be resolved for address-based policy conditions. Keep checked addresses in static account keys; otherwise the provider rejects the transaction. Do not weaken the policy to make a large transaction pass.
- Transaction-level SOL budgets, aggregate daily loss limits, priority-fee bounds, slippage, position limits, cost basis and exact token-program extensions require explicit implementation and tests. The reviewed documentation does not establish that a simple program allowlist supplies these protections.

The current launcher creates Token-2022 coins, while the observe-only worker treats Token-2022 balances as unspendable pending extension review. Safe extension-aware inventory and unsigned transaction simulation are prerequisites to making those coins tradable; merely attaching a signer does not fix this mismatch.

## Free-plan boundary and acceptance

The official pricing page observed on 2026-10-28 lists Developer at 0–499 monthly active users, 50,000 signatures/month and $1 million transaction volume/month, with delegated access and policy controls available. Paid tiers and usage terms exist, including automatic upgrades described in the FAQ. Recheck the account's actual limits and billing controls before enabling recurring activity; this work does not approve any paid plan or overage.

Local verifier tests use injected public fixtures only. They cover wrong app/issuer/expiry, external or different-owner wallets, unscoped/extra/revoked grants, modified policies at the same ID, deterministic policy hashing, fresh reads and error redaction. A live product acceptance still needs the user's explicit wallet creation/delegation flow, correct provider owner mapping, a reviewed constrained policy, funded execution prerequisites, and a separately authorized transaction acceptance. Do not claim that a login or green unit suite proves live trading.

## Official references

- [Node SDK setup](https://docs.privy.io/basics/nodeJS/setup)
- [Access-token verification](https://docs.privy.io/authentication/user-authentication/access-tokens)
- [Solana integration](https://docs.privy.io/recipes/solana/getting-started-with-privy-and-solana)
- [Configure additional signers](https://docs.privy.io/wallets/using-wallets/signers/configure-signers)
- [Add signers](https://docs.privy.io/wallets/using-wallets/signers/add-signers)
- [Remove signers](https://docs.privy.io/wallets/using-wallets/signers/remove-signers)
- [User-owned offline authorization](https://docs.privy.io/controls/authorization-keys/owners/configuration/user/offline)
- [Solana policy examples and limitations](https://docs.privy.io/controls/policies/example-policies/solana)
- [Solana IDL conditions](https://docs.privy.io/controls/policies/example-policies/solana-idls)
- [Privy pricing](https://www.privy.io/pricing)
- [Phantom agent-account separation](https://docs.phantom.com/phantom-mcp-server/account-types)
- [SPL delegation scope](https://solana.com/docs/tokens/basics/approve-delegate)

## Server adapter (wired)

`api/agent-wallet/readiness.ts` serves the readiness route. `api/_privy-provider.ts` maps raw `@privy-io/node` resources onto the verifier contract: `utils().auth().verifyAccessToken`, `users()._get`, `wallets().get`, `policies().get`. Privy's wallet `owner_id` is a key quorum, not a user DID, so ownership means an embedded, non-imported Solana account linked to the verified user plus a non-null owner quorum on the wallet. A policy with no owner fails as `policy-not-approved`. With any server value missing, the route answers `configuration-missing` and makes no Privy calls.

Still open: create the GrokGrid Privy app, the agent signer key quorum and the policy (built from the approved limits in the protected config), then set the env names above in Vercel.

## Setting up GrokGrid's Privy app (dlao)

The three steps below never print a secret. The clipboard is cleared after each save.

1. Copy the **App secret** from the Privy dashboard, then run (put your App ID in place of the placeholder):
   ```sh
   GG=~/.config/grokgrid/runtime; APP_ID='<your Privy App ID>'; (umask 077; pbpaste | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("fs").writeFileSync(process.argv[1],JSON.stringify({appId:process.argv[2],appSecret:s.trim()})+"\n",{mode:0o600});console.log("saved privy-server.json")})' "$GG/privy-server.json" "$APP_ID") && pbcopy </dev/null
   ```
2. Create an **authorization key** in the dashboard, copy its private key (`wallet-auth:…`), then run:
   ```sh
   GG=~/.config/grokgrid/runtime; (umask 077; pbpaste | tr -d '\n' > "$GG/privy-authorization.key") && pbcopy </dev/null && echo saved privy-authorization.key
   ```
3. Create the signer and the policy:
   ```sh
   cd ~/coding/grokgrid-main && git fetch -q origin main && git checkout -q --detach origin/main && npx tsx ops/privy-setup.mjs
   ```
   It prints only public values:
   - the signer (key quorum) ID and its public key;
   - the policy ID, the policy SHA-256 (`privyPolicyFingerprint`) and the one-line summary;
   - the Vercel env names to set.

   Set `PRIVY_APP_SECRET` in Vercel yourself. The authorization key never goes to Vercel: the site only verifies wallets and never signs, so the key stays on the Mac for the agent runner.

**The policy** (`ops/privy-setup.mjs`, check offline with `--dry-build`) is default deny. It allows `signTransaction` only for:
- compute-budget instructions;
- token-account creation;
- pump.fun curve `buy` with `max_sol_cost` ≤ 0.05 SOL, and curve `sell`;
- PumpSwap `buy` with `max_quote_amount_in` ≤ 0.05 SOL, and PumpSwap `sell`;
- SOL transfers ≤ 0.05 SOL (the PumpSwap SOL wrap);
- WSOL `SyncNative` and `CloseAccount`.

Every IDL check sits in the same rule as its program-id check. There is no message signing and no key export. The signer quorum owns the policy, so the app secret alone can't loosen it. Total size is about 23 KB.

**Known limits.** A system transfer's recipient and a `CloseAccount` destination can't be pinned per wallet, so a stolen authorization key could move up to 0.05 SOL per transaction that way, repeatedly. Keep the key file 0600 on the Mac only; remove the signer in Privy if it ever leaks. The runner's caps, daily-loss stop and stop file still apply on top of the policy.
