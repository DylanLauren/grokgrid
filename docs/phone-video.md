# On-demand real phone video

This optional sidecar keeps the existing JPEG feed intact. The native Mac helper
remains the Screen Recording permission owner; its Node supervisor can launch
`phone-video-controller.mjs` as a child. No native application rebuild is needed
for that integration. The controller does not begin capture while the room has
no authorized viewers.

The fixed LiveKit room is `grokgrid-house`. Its ingress participant must have
identity `house-publisher`. With the selected non-transcoding WHIP ingress, the
observed video track name is `synthesized-camera`; the configured ingress video
name `grokgrid-phone` does not override that provider-generated track name.
The viewer accepts only that observed video track under the pinned publisher.
Only standard participants with `viewer-<UUID>` identities and subscribe-only
permissions count as viewers. The controller polls every three seconds and
stops capture/encoding after five seconds without viewers. A failed viewer
query stops publication rather than assuming someone is still watching.

## Private configuration

The controller accepts `--config /absolute/private/config.json --check` (also its
default) or `--run`. Only the explicit run mode may connect an encoder.

The private JSON fields are:

| Field | Purpose |
| --- | --- |
| `sourceConfigFile` | Existing pinned Chrome capture config; only source fields are read |
| `chromeWindowId` | Matching Chrome AppleScript window ID |
| `expectedWindowSize` | Optional dedicated-window outer size, for example `{ "width": 406, "height": 851 }` |
| `serverUrl` | HTTPS LiveKit project API origin |
| `apiKeyFile`, `apiSecretFile` | Separate private provider credential files |
| `whipUrlFile` | Full private ingress publish URL |
| `captureBinaryPath` | Compiled `phone-video-capture.swift` executable |
| `ffmpegPath` | Installed ffmpeg executable with WHIP muxer support |
| `statusFile` | Private status JSON, alongside the controller config |
| `roomName` | `grokgrid-house` |
| `publisherIdentity` | `house-publisher` |

Config and credential files must be regular, owned, single-link files with no
group/other permissions, under owned private directories. Paths cannot contain
symlink ancestors. Never place these files or their contents in the repository.
Compile the Swift source with `swiftc -parse-as-library` into the private runtime
directory. Keep the binary executable only by its owner.

LiveKit documents the WHIP endpoint as the ingress URL followed by `/` and the
stream key in its [encoder configuration guide](https://docs.livekit.io/transport/media/ingress-egress/ingress/encoders/).
Store that complete value only in `whipUrlFile`. A localhost signaling bridge
keeps it out of ffmpeg arguments and suppresses provider error output. The bridge
preserves mapped session URLs, query credentials, ETags and PATCH/DELETE bodies;
it rejects upstream redirects and foreign-origin session locations. Shutdown
also attempts bounded DELETE requests for sessions the encoder did not close.
The installed ffmpeg WHIP client rejects TCP ICE candidates in otherwise usable
SDP answers. For successful SDP POST responses only, the bridge removes TCP
candidates when the same media or explicitly shared BUNDLE transport offers a
usable UDP candidate for that ICE component. Without a UDP alternative it fails
closed. ICE credentials, fingerprints, codec attributes, UDP candidates and
non-SDP/PATCH/DELETE bodies are preserved; response framing uses the new body size.

## Capture and recovery boundaries

ScreenCaptureKit selects only the configured window ID, owner PID, Chrome bundle,
title and full bounds. Its AppleScript window must match those bounds exactly,
including position, and the title/bounds match must be unique. Page URL and
viewport checks run before and after extracting each changed frame and before
emitting video frames. The SCK identity/bounds binding is rechecked every 500 ms.
Changing the source stops video; no other window or desktop is substituted.

The page crop removes Chrome tabs/address bar. Output uses even dimensions,
up to 780 px wide, targeting 15 fps; audio, cursor, shadows and child windows are
excluded. Actual frame rate depends on the capture/guard/encoder work and must be
measured during acceptance. H.264 is sent through ffmpeg's WHIP muxer.

For a static page, the encoder receives repeated actual pixels while the same
source/session remains verified. An unchanged cache is refreshed using a new
SCK screenshot of that exact window every two seconds. Frames are withheld when
the cached image is four seconds old or identity health is over 1.5 seconds old;
indefinitely stale pixels are not presented as live video.

Guard failures stop video immediately. A retry can proceed only after a new full
check confirms the exact same configured source. A failed revalidation holds for
operator review; no window is repinned. Recovery attempts, including encoder and
transport failures, are bounded to three after 5, 10 and 20 seconds.
Parent exit, explicit stop and app Pause must terminate the sidecar and its
capture/encoder children. No viewer means no video capture or encoder process.
The existing JPEG fallback remains independent until full video acceptance.

## Verification status

Local tests cover viewer demand, private-file checks, source-versus-transport
restart decisions, localhost-only encoder arguments, and WHIP session forwarding,
cleanup, redirect restrictions and UDP-only SDP compatibility. The Swift
implementation typechecks against the installed macOS SDK. Actual LiveKit
publication and decoded Chrome playback were subsequently verified below,
including a 60-second 15 fps run. Local source checks also passed off-Space.
Those results do not by themselves prove uninterrupted multi-viewer playback or
every restart case; the later lifecycle observations distinguish what was tested.

### Local capture observation — 2026-10-29 UTC

A six-second, local-only probe counted and immediately discarded raw frames;
it opened no encoder or provider connection and wrote no image files. The
optimized guard produced 81 complete 780×1144 frames in 6.01 seconds (about 13.5 fps
including startup), with zero partial frames and no capture errors. The exact
source was `onScreen:false` immediately before this probe. The original repeated
Apple Events implementation produced only 7 frames in 6.05 seconds and was replaced
by a direct-window JavaScript guard plus native geometry/title checks. These are
capture-path observations, not evidence of decoded LiveKit video.

Bounded encoder stderr diagnostics stay in a private 0600 runtime log. The
adjacent diagnostic JSON contains only numeric child exits, whitelisted failure
categories, frame-byte counts and upstream signaling HTTP statuses. Never paste
the raw stderr or configuration files into chat.

### Controlled LiveKit playback acceptance — 2026-10-29 UTC

The first actual Chrome player decoded 134 frames over 8.8 seconds at 780×1144,
showed the correct pump.fun profile, and excluded Chrome tabs/address bar. Its
wide page aspect left letterboxing; that framing was superseded.

A portrait trial used a compact app-style window opened in the already-running
Default Chrome profile, with fresh explicit window pins. The real player decoded
176 frames over 11.7 seconds at 780×1688 (about 15 fps). Visual inspection confirmed the
correct profile fills the phone without browser chrome or clipped page content.
This is observed browser playback, beyond the earlier local raw-frame probe.
The controller and capture binary were not replaced during active playback.

A subsequent 60-second real-browser run collected 61 samples. Video time advanced
from 32.444280 to 92.447219 seconds and decoded-frame count advanced from 487 to 1387:
900 decoded frames in 60 seconds, or 15 fps. Every sample had the active overlay and
`readyState:4`; there were zero inactive, stalled or not-ready samples. The
observed video remained 780×1688 throughout. Multi-viewer/last-viewer shutdown
must be assessed separately from these playback results.


### Optional dedicated-window size recovery

Only an explicitly configured `expectedWindowSize` enables resizing. Before a
run-mode capture starts or restarts, the native preparation mode verifies both
pinned window IDs, owner PID, URL, title, current full bounds and unique binding.
It then changes only that exact Chrome window's width/height, preserving x/y.
It does not activate, navigate, unminimize, select another window or repin.
A fresh independent read-only check must confirm the result before capture.

`--check` remains read-only and never invokes preparation. A failed binding,
failed resize or failed subsequent inspection prevents publication. Geometry
changes during a live stream still withhold frames and stop that capture;
recovery begins through the same full preparation/check sequence. The optional
size should be configured only for the dedicated app-style source, not general
browsing windows. Local tests cover opt-in behavior, read-only behavior and
failure ordering; actual resize acceptance is performed by the controlling
operator separately.

Size verification includes both native bounds and the page's outer dimensions,
inner viewport and device-pixel-ratio crop calculation. A hidden Chrome renderer
can temporarily retain its old viewport after native bounds change; preparation
waits for agreement and otherwise fails closed. Native bounds alone are never
reported as a successful restoration, including when no further resize is needed.


The 780×1688 portrait trial was subsequently superseded for native work-area
compatibility. A source outer height of 896 exceeded the available work area and
could leave JavaScript viewport dimensions inconsistent with requested bounds.
The replacement dedicated window uses native outer size 406×851 at (10,40), with
page viewport 406×819 and a 32-pixel title bar removed. Its checked video output
is 780×1572, preserving the complete page with only a small aspect-ratio margin.
With publication paused, the operator changed only the verified dedicated source
width from 406 to 440. Read-only checking rejected it with `source-size-mismatch`;
preparation returned `changed:true`, and a new independent check passed at
780×1572. This verified the configured size recovery without changing source pins.

During the final lifecycle check, the main QA tab became hidden through a focus
change outside the test. The temporary second subscribe-only participant remained
connected after the main viewer left, but the encoder encountered a transport
failure, so this is not evidence of uninterrupted remaining-viewer playback.
Private diagnostics identified ffmpeg rejecting TCP ICE candidates despite UDP
alternatives; the compatibility fix above addresses that specific failure.
After disconnecting the temporary participant, status at 01:01:40 UTC reported
zero viewers and `waiting-for-viewers`, with no video capture or ffmpeg children.
The JPEG fallback may separately report `waiting-for-window` when the pinned
window is off-Space; that does not establish a failure in SCK video capture.

### UDP compatibility and demand lifecycle acceptance — 2026-10-29 UTC

After reloading the helper with the compatibility fix, the bridge received
HTTP 201 and removed four unsupported TCP candidates. The approved QA tab stayed
hidden; two temporary real subscribe-only Room connections exercised the service
without taking browser focus. One actual WebRTC receiver reported 285 decoded
frames at the corrected 780×1572 size, with 2.5 MB received.

At 01:03:59 UTC the controller reported two viewers and 480 complete frames.
After one connection left, 01:04:21 UTC showed one viewer and 800 complete frames;
both capture and encoder retained their original process IDs. After the last
connection left, 01:04:39 UTC showed zero viewers, `waiting-for-viewers`, and no
capture or ffmpeg children. A fresh connection then restarted both processes;
at 01:05:08 UTC the controller reported one viewer and 252 complete frames with
a new successful HTTP 201 and the same four-candidate compatibility adjustment.
That restarted receiver decoded 255 frames at 780×1572. Both temporary connections
were then explicitly disconnected, leaving the helper available for future demand.
These are service and decoded-media checks, not a claim of two simultaneously
rendered phone interfaces. Visible primary-interface playback was verified in
the earlier 60-second run.
