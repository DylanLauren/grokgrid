# Read-only launched-agent rule snapshots

The balance observer records launch-rule evidence while holding its existing
single-writer journal lock. It reads the authenticated latest-launch list and,
only when current or previously observed launches exist, the public `/api/agents`
registry. It does not acknowledge a queue entry, lease a wallet, start an agent,
activate a policy, load wallet keys, or sign or submit a transaction.

`launch-rule-observations.json` is a private, atomic, checksummed local snapshot.
Each entry pins agent ID, public wallet, mint, and the original queued timestamp.
A different identity for that ID, reused wallet/mint, house/burn-wallet collision,
or duplicate registry ID causes a sticky identity hold. Registry text and numbers
are untrusted data; a strategy description is never executed or treated as agent
instructions.

Accepted rule fields match the existing launch form's bounds. SOL amounts convert
exactly to integer lamports, and percentages to integer basis points. Unsupported
precision, unknown rule fields, invalid ranges, control characters, missing data,
or a registry timestamp older than 90 seconds prevent a valid new snapshot.
Conversion never silently rounds the owner's values.

Each distinct normalized policy carries schema version 1, a SHA-256 policy hash,
a local `observationVersion`, observation time, and upstream registry timestamp.
The local observation version is **not** an upstream policy version or approval.
Old versions remain present when new rules appear; a change stays held for review
even if the server later restores an older value. Missing/stale registry data does
not erase prior versions or make them current.

`activePolicy` remains null, and acknowledgement/execution remain false. This store
is separate from the trading worker's approved-policy inputs. It supplies reviewable
evidence only; possession of a matching hash does not authorize a trade.

The upstream endpoint supplies only the latest 50 launches with no durable cursor
or acknowledgement protocol. Therefore `historyComplete` is always false and
`upstreamTruncationUnknown` is always true—even when the response is empty or shorter
than 50 entries. Local observations do not prove delivery of every launch. Reliable
upstream pagination/delivery and rule approval are still required before activation.

The store retains at most 1,000 identities and 32 distinct versions per identity.
Capacity limits are reported and stop additions; they do not remove old evidence.
A malformed/checksum-invalid store is preserved and reported unavailable. The
observer status exposes summary counts, never private credentials.

Validation: `npx tsx --test tests/runtime-launch-rules.test.ts` covers exact units,
idempotency, immutable identities, collisions, changed/reverted rules, invalid and
stale data, restart retention, incomplete upstream history, and asynchronous
registry-fetch timestamps. Tests use fixtures and perform no financial execution.

The trading status now includes `readiness.launchReadiness` alongside house-wallet
readiness. It validates the snapshot schema, timestamps, safe counts and disabled
flags, then reports identity/rule-change holds, missing rules, unknown queue data,
and capacity limits. Stale or malformed evidence yields unknown counts (`null`),
not zero. Fresh evidence still has no approval and cannot enable launches. Missing,
null, or malformed upstream queue data remains `pendingLaunches: null` through the
observer and trading CLI; only an actual empty array means zero observed launches.
