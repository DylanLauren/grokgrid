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
