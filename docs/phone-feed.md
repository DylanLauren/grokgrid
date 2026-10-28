# Real phone capture on macOS

The publisher captures one explicitly selected window. It never falls back to a
desktop rectangle, a screenshot of the whole screen, or a synthetic frame. Select
only the actual window Grok controls. A local pump.fun window that Grok does not
use is not a substitute for its real screen.

Cloud Grok's computer currently suspends during idle periods. This script does
not prevent that suspension. Continuous capture requires the real bot workflow
to run on an awake host. The Mac must stay logged in, its capture permissions must
remain granted, and the chosen window must remain available. No paid keep-alive
is enabled by this implementation.

## Configure, check, then start

Create a private directory (mode 700) outside the repo and a configuration file
(mode 600) with the following fields. Replace the illustrative window identity
with a freshly inspected actual window; identities change on application restart.

```json
{
  "source": "grok-bot-actual-window",
  "windowId": 123,
  "ownerPid": 456,
  "bundleId": "com.google.Chrome",
  "title": "EXACT WINDOW TITLE",
  "browserUrl": "https://pump.fun/",
  "tokenFile": "/absolute/private/screen-capability",
  "statusFile": "/absolute/private/phone-status.json",
  "site": "https://grokgrid-alpha.vercel.app",
  "everyMs": 2500
}
```

The `windowId` is the CoreGraphics window number used by `screencapture -l`,
not Chrome’s AppleScript window ID. These are different identifiers. The Swift
helper can check a known CoreGraphics ID without capturing pixels.

The token file must contain an unexpired `screen-v1` capability, not the full
`INGEST_TOKEN`. The full secret is never needed by this capture process. Both the
configuration and capability must be owned by the current user and inaccessible
to group/other users. Capabilities are accepted only with 15 seconds or more
remaining and a maximum seven-day validity. Renew separately before expiry;
there is no automatic renewal or privilege escalation.

The allowed destinations are the production Vercel origin and www.grokgrid.fun.
The publisher rejects redirects and never retries a request against another URL.
For Chrome, the active tab URL must match `browserUrl` exactly and be on pump.fun.
The window title, owning PID, bundle ID, on-screen state and phone-like geometry
must all match. Navigation, tab switching, movement or resizing during capture
causes that frame to be discarded. This may pause publishing during legitimate
navigation; re-pin the expected window only after reviewing the new source.
Pre/post checks cannot detect every possible transient in-page change between
checks. Keep wallet secrets and unrelated browsing out of the dedicated window.

```sh
node scripts/phone-feed.mjs --config /absolute/private/config.json --check
node scripts/phone-feed.mjs --config /absolute/private/config.json --once
node scripts/phone-feed.mjs --config /absolute/private/config.json
```

`--check` checks credential shape/expiry and live window identity without capturing
or uploading any image. It does not verify the capability signature with the
server. `--once` captures and uploads a real frame; run it only after confirming
the source is the actual bot window. macOS Screen Recording and Chrome Automation
permissions may require the user's direct action. No process is started by adding
these files to the repository.

## Operational behavior

Window capture uses `screencapture -l` rather than a desktop rectangle. Temporary
images are held in a unique private directory and removed after capture. The
output is resized to 390 pixels wide, JPEG encoded, and limited to 330 KB before
base64 encoding. Capture/conversion/upload have timeouts. Status writes are atomic
and contain no credential, image, browser URL or window title.

`phone-status.json` records `state`, `observedAt`, `lastSentAt`, failure count,
window ID and credential expiry. The server response must succeed before
`lastSentAt` advances. Readers should treat this timestamp as stale after 12
seconds without success; a `sending` string alone never proves liveness. The
website's own frame freshness is authoritative for what viewers receive.

Transient failures use exponential backoff up to 60 seconds. Eight consecutive
failures stop the publisher. HTTP 401/403, other non-rate-limit 4xx responses, or an
expired capability stop immediately. Errors are reduced to fixed codes, never
raw tool/network exceptions or credential-bearing URLs. SIGINT/SIGTERM stop
publishing and remove the process lock. A lock prevents competing publishers
using the same status path. After a crash, verify that the recorded PID is no
longer running before manually removing the `.lock` file. Do not use unconditional
KeepAlive restarts that repeatedly retry expired credentials.

Legacy `--rect` and environment `INGEST_TOKEN` invocation are intentionally no
longer accepted. They could expose unrelated desktop content and grant the
capture process unnecessary privileges. Migrate to the pinned-window config.

## Completion criteria

The phone pillar is not complete until Grok actually works in the selected local
window, the publisher is exercised against production, and the real feed stays
fresh during a sustained idle/recovery test. This code prepares that workflow;
it does not claim that the cloud agent has been migrated or is trading.

## Production verification — October 28, 2026

Three read-only checks were made against `https://grokgrid-alpha.vercel.app`,
approximately 30 seconds apart. Screen response bodies were cancelled without
saving or displaying image content. No capture process or desktop action was
started by these checks.

| Observation (America/Los_Angeles, PDT) | `/api/live` | `screenTs` | `/api/screen` | Frame timestamp header |
|---|---:|---:|---:|---|
| 3:36:49 PM | 200 | 0 | 404 | absent |
| 3:37:20 PM | 200 | 0 | 404 | absent |
| 3:37:50 PM | 200 | 0 | 404 | absent |

Both endpoints returned `Cache-Control: no-store` in every sample. The deployed
site consistently reported an offline feed. This does **not** establish whether
an active feed survives cloud idle: no active starting frame was observed.
Continuous operation must be tested after establishing a real active source.

## Crash cleanup review

Normal capture completion and capture/conversion errors remove `frame.jpg` in a
`finally` block. Normal process exit, including handled SIGINT/SIGTERM after the
bounded in-flight operation finishes, removes that process's unique temporary
directory and lock. The directory is created with `mkdtemp` under a restrictive
umask; images are accessible only to the current user. No old frame is reused on
startup because every process receives a new random temporary directory.

A forced kill, machine crash, or failed filesystem cleanup can leave a private
JPEG and stale lock behind. The current publisher deliberately does not sweep
`grokgrid-phone-*` directories or delete other processes' files on startup. Its
PID-only lock does not identify a temporary directory well enough to authorize
automatic cleanup. No stale images or directories were deleted during this review.

A possible follow-up is a private per-run manifest containing a random run ID,
PID, process start identity, and exact temporary-directory path, written before
capture. Recovery should require verifying the process is no longer that exact
running instance, checking ownership and permissions with `lstat`, rejecting
symlinks or paths outside the expected temporary parent, and deleting only the
known `frame.jpg` and manifest before removing an empty directory. PID reuse or
any uncertain ownership should leave files untouched for operator review. That
recovery mechanism is a proposal, not an implemented startup behavior.

## Local browser commissioning — October 28, 2026

Grok successfully read the title, URL and public page text from the user's existing
Chrome window on pump.fun through its local terminal. This established local
observation, not autonomous trading. A pinned, phone-shaped window passed the
publisher preflight and a real JPEG was accepted by production with matching
`/api/live` and `/api/screen` timestamps. The continuous publisher subsequently
produced advancing fresh frames in the interactive permission-granted session.

The first LaunchAgent attempt could not validate the window while the interactive
process could. It was unloaded and its plist moved out of LaunchAgents; unattended
login restart is **not verified**. Do not claim durable restart support based on
the interactive capture test. The initial local screen-only capability lasts
24 hours; publication stops at expiry unless separately renewed. The publisher
is pinned to one exact URL/title/window and stops or pauses after source changes.
Stop it before wallet setup or other sensitive browsing.

## Local screen capability renewal

Run the issuer separately from the publisher. The issuer alone reads the full
local ingest credential; the publisher configuration points only at the resulting
screen-only capability. Neither the credential nor capability is printed.

Create a mode-600 renewal config in a mode-700 private directory, owned by the
current user, containing only these path fields:

```json
{
  "sourceTokenFile": "/absolute/private/ingest-token-production",
  "destinationTokenFile": "/absolute/private/local-phone-capability"
}
```

```sh
node scripts/phone-renew.mjs --config /absolute/private/renewal-config.json
```

The command creates a missing capability with a 24-hour lifetime. An existing
valid capability is left byte-for-byte unchanged until it has six hours or less
remaining; it then receives a new nonce, signature and 24-hour lifetime. An
expired capability may also be renewed if its signature still matches the local
ingest secret. A malformed capability, an unexpected full-scope token, or one
signed by a different secret fails closed without being overwritten. After an
intentional ingest-secret rotation, the operator must explicitly reconcile that
mismatch; it is not silently treated as normal expiry.

Files and their immediate parent directories must be private and user-owned.
Symlinks in any path component, hardlinked credential files, shared file modes,
relative paths, and aliases between config/source/destination are rejected. An
exclusive per-destination issuer lock prevents simultaneous writers. The new
capability is written to a unique mode-600 file, fsynced, atomically renamed over
the previous capability, then the destination directory is fsynced. Existing
readers keep a complete old file; new readers see the complete replacement.

The publisher must re-read its screen-only file before each capture cycle to use
renewal without restarting. It must retain expiry validation and reject invalid
replacements. Schedule the separate issuer often enough to run within the
six-hour renewal window (for example, hourly). Installing a schedule is a
separate integration step; running the command once does not schedule renewal.
CLI output contains only `state`, `expiresAt`, and `renewAfter`, or a generic
failure message. No full credential is put in publisher config or environment.

A forced kill can leave an issuer `.renew.lock` or a private temporary file.
A well-formed private issuer lock may be recovered only when two process probes
return `ESRCH` for its recorded PID. Successful probes, `EPERM`, malformed metadata,
nonprivate files, hardlinks, symlinks, or a reused/alive PID all hold the lock.
Immediately before removal, the issuer re-reads and compares device, inode and
complete lock contents. A changed lock is never removed.

A separate exclusive recovery guard serializes this check-and-remove sequence,
so two reclaimers cannot unlink each other's newly acquired issuer locks. A
crashed or uncertain recovery guard is held for operator review rather than
recursively reclaimed. A new issuer that wins the exclusive lock creation is
left alone; the losing issuer fails and can be retried later. Private temporary
files are not swept. Normally exiting issuers clean up only their own temporary
files and locks using recorded inode ownership; the destination capability stays.
Renewal tests use only temporary fixture credentials, including dead/live/PID-reuse
and replacement-lock scenarios. No production credential is accessed by tests.

## Native permission owner and restart supervision

`scripts/install-phone-app.py` builds `~/Applications/GrokGrid Phone.app` from
`scripts/phone-app.swift`. It starts no capture and grants no permission. Open
the app and grant macOS Screen Recording permission directly. Rebuilding its
ad-hoc signed binary may require a new OS grant. The menu-bar **GG** menu can
pause or resume publishing. After pausing, let the publisher stop before Resume.
Quit leaves a pause marker so login startup cannot undo an intentional stop.

The app runs `phone-supervisor.mjs --config` with the protected publisher config.
The supervisor restarts transient publisher failures with bounded delays, recovers
only verified dead-process locks, waits for a changed capability after expiry,
and stops for authorization rejection or prolonged source mismatch. It never
chooses a different window. Parent-process checks shut down descendants if the
app or supervisor disappears; a surviving/uncertain owner is never killed or
adopted merely to clear a lock. An unresolved recovery guard requires review.

Local login registration uses `fun.grokgrid.phone-app` to open the app at login
and check for its presence every60seconds. `fun.grokgrid.phone-renewal` runs the
separate issuer at login and every30minutes. These LaunchAgents work only in the
logged-in user's session. They do not capture at the lock screen, prevent manual
sleep, or make Grok act between prompts. A recreated Chrome window needs a fresh
explicit pin; changing tabs is not authorization to broadcast the new page.

The helper's `phone-app-status.json` reports OS capture permission and supervisor
process state. `local-phone-supervisor-status.json` reports restart/hold state.
Neither proves live pictures: `local-phone-status.json` lastSentAt and production
frame timestamps remain the checks for current capture.

## Restart observation qualification — October 28, 2026

A read-only metadata check at 4:41:57 PM PDT observed local publishing and matching
fresh production timestamps. After the parent-controlled publisher kill, checks
at 4:42:38 and 4:42:58 observed expired production frames (404). At 4:43:18,
4:43:39 and 4:43:49, fresh frames returned; the publisher lock PID changed from
14102 to 14655. This supports recovery of the local publisher process after its
configured backoff.

A subsequent native-helper crash test requires qualification. At 4:44:02 a new
helper PID 14818 and publisher PID 14820 were present and the local status said
`sending`. From 4:44:23 through 4:45:24, however, local status reported
`window-identity-mismatch` with its last successful send stuck at 4:44:04, while
production timestamps continued advancing. The parent then visually confirmed
that production showed the old cloud pump.fun welcome screen and that the local
dedicated window had changed to a different page and geometry.

**Production freshness during that mismatch does not prove local native-helper
feed recovery.** The new process IDs establish process reopening, but another
publisher contaminated the remote observations. The remaining sampler was
stopped without further desktop or publishing changes. Before claiming complete
native-helper feed recovery, stop the old cloud publisher, establish one exclusive
actual source window, and repeat the controlled crash/recovery test. Merely seeing
HTTP 200 or an advancing global frame timestamp is insufficient to identify which
publisher produced the image.

## Current response caching and source retirement

PR16 introduced one-second edge caching for successful live metadata and screen
responses (`public, max-age=0, s-maxage=1`); errors remain uncached. Earlier dated
`no-store` observations above describe the earlier deployment. Origin checks
still reject missing, future or12-second-old frames; the edge may retain a valid
response for another second. Browser rendering independently checks frame age.

After the source conflict was identified, Grok verified and terminated the old
cloud `cloud-capture.py` process and removed its publishing-enable marker.
Production then returned404 while the local guarded publisher was stopped.
The local near-expiry credential was renewed successfully through the configured
issuer. An exclusive-source live recovery repeat remains required after other
desktop automation stops changing the dedicated browser window.
