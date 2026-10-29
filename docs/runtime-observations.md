# Durable house and burn-wallet observations

The observer records finalized **balance observations**, not transaction receipts,
creator-fee revenue, purchases, or burns. It does not load wallet keys or construct,
sign, or broadcast transactions. Setting an official mint does not enable execution.

Each successful sample records both public wallets, integer lamport balances, the
RPC's finalized context slot, and the previous successful observation timestamp.
A lower context slot or different balances at the same slot is rejected. A balance
change is only the net change between those two observations: intervening deposits
and withdrawals may cancel, and the change does not establish its source.

`observer-observations.jsonl` in the protected runtime directory is append-only.
Each record includes a sequence, hash of the preceding record, checksum, current
observation, and a compact copy of the latest successful sample. An unavailable
sample preserves that successful baseline, including across process restarts.
The journal is fsynced before the disposable `observer-status.json` view is replaced
with a unique temporary file, file fsync, atomic rename, and directory fsync. The
status includes its corresponding `observationSequence`.

A single-writer lock prevents overlapping observers. A lock owned by a live or
uncertain process is retained; a definitely dead PID can be recovered under a
separate exclusive recovery guard. A leftover recovery guard requires inspection.
Private files must be owned, not shared through hardlinks or symlinks, and protected
from group/other access. Existing permissions are checked, never silently changed.

Startup validates the bounded journal tail, its checksums, adjacent sequence/hash
link, and wallet identity. This is crash/corruption detection, not a full-history
integrity audit or protection against someone controlling the local account.
A malformed, corrupt, or partially appended final record stops observation without
truncating evidence. Preserve and inspect that file before manually repairing a
partial append. The implementation does not silently reset history or rotate it;
long-term archival/retention is a separate maintenance task.

The first entry in a newly created journal establishes a baseline. It does not
infer a change from an older legacy status file. With no official mint configured,
the burn state remains `awaiting-official-mint`; positive funds may still be
observed and recorded, but revenue verification and execution remain false.

Validation: `npx tsx --test tests/runtime-observer-store.test.ts tests/runtime-policy.test.ts`.
The tests exercise restart/unavailable continuity, status-publication failure,
wallet drift, incomplete/corrupt records, writer exclusion, dead-lock recovery,
private-file rules, and finalized slot regression/conflicts. They perform no
network requests, transaction signing, or financial execution.
