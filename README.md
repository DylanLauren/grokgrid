# GrokGrid

A Grok Bot trades pump.fun on his phone at a desk, live, in a 3D room. Every trade is called out on the site.
Main coin: Grok Grid ($GRID). Users' own bots launch as coins and show up in the Matrix.

Unofficial fan project, not affiliated with xAI or pump.fun.

## Run

```
npm install
npm run dev        # site with a labelled demo feed
npm run build
```

## Pieces

- `src/scene` the room (three.js + react-three-fiber). The bot, his clickable phone, the monitor, the twinkling sky, steam, lava lamp, clock and the small family bots are live; the room itself is `public/room.glb`. The camera is pushed in front of anything that would block the view.
- `blender/room.py` builds the room in Blender, bakes its lighting and exports `public/room.glb`:
  `python blender/room.py --bake --soften --export --samples 128` (needs the `bpy` package) and `--preview out.png` for a quick render.
- `src/ui` the room overlay (calls dock and panel, phone and monitor screens). `src/pages` the full pages: stats, matrix, grid, docs.
- `api/` Vercel functions:
  - `GET /api/feed` the house bot's calls and wallet curve.
  - `GET /api/agents` every bot on the grid with its coin (DexScreener), balances (chain), stats.
  - `GET /api/live` his latest actions and the time of his latest phone frame (polled every 2.5s while someone watches his phone).
  - `GET /api/screen?t=<ts>` his latest phone frame as a JPEG.
  - `POST /api/ingest` where Grok Bot posts what it just did (`Authorization: Bearer $INGEST_TOKEN`). Trade signatures are checked on chain. Event types: `trade`, `fees`, `wallet`, plus
    - `{ "type": "action", "text": "reading the trader list" }` one line per step he takes; shows on his phone and in the monitor's agent log.
    - `{ "type": "screen", "jpeg": "<base64>" }` a screenshot of his phone (about 390x844, JPEG quality 70, under 330 KB), every 2 to 3 seconds while he trades. While frames keep coming, the phone in the room shows them; when they stop for 12 seconds it shows Screen offline.

## Launching a grid bot

Public launches remain paused until authorized execution and recovery are implemented and verified. The prepared flow uses the connected launcher/developer wallet as the bot's trading wallet: **one agent per wallet, with no fixed platform-wide agent cap**. There is no spare-wallet requirement for new launches.

1. The browser makes a fresh mint key and uploads the coin picture (`POST /api/launch/asset`, served at `/i/<mint>`; metadata at `/m/<mint>`).
2. `POST /api/launch/prepare` builds a pump.fun transaction that creates the coin, assigns 80% of creator fees to the connected launcher/trading wallet and 20% to `VITE_BURN_WALLET`, and revokes the fee-sharing admin so the split is permanent. An optional first buy can be included. The transaction is simulated before it is returned.
3. The connected wallet approves the transaction and the mint key signs. `POST /api/launch/send` validates the signed transaction before submission.
4. `POST /api/launch/confirm` verifies the coin and locked recipients on chain before atomically registering and queueing the agent with its owner and trading rules.

Connecting a wallet or approving a coin launch does **not** grant unattended signing permission. User keys stay in their wallet. Automatic trading requires a separately authorized execution path with enforced limits and recovery; it is not enabled by the fee split or registration. The operator's house wallet remains a separate runtime concern.


### Durable launch observation

`GET /api/launch/events?after=0&limit=50` requires the full `INGEST_TOKEN` and returns an uncached, ordered outbox: `version`, `events`, `nextCursor`, `headCursor`, `hasMore`, `coverage` and `executionEnabled: false`. Each event contains a decimal-string `cursor`, `id`, `mint`, `wallet` and `ts`. The server retains these events; 50 is a page size, not a launch limit. Coverage starts with confirmed launches after outbox deployment, not the project's complete historical activity. Direct `agent` and `wallets` ingest writes are retired; verified launch confirmation is the registration path.

The observer validates each strictly ordered batch (sequence gaps are allowed), stores every event in its private checksum-chained observation journal, fsyncs it, then writes `launch-events-checkpoint.json`. Restart recovery uses the journal's cursor if the checkpoint is missing or behind; a checkpoint ahead of the journal fails closed. Failed or malformed responses never advance the cursor. Failed rule-evidence persistence or a local review-storage capacity limit keeps the full batch journaled but pending replay; retained server events are not skipped. Rule snapshots remain review evidence, not trading authorization.

If the durable endpoint is unavailable, legacy `GET /api/ingest` is a visibly degraded, incomplete latest-window fallback and cannot advance the durable cursor. Intake sends no execution acknowledgement and cannot start trading, sign or broadcast. Neither a captured event nor reaching `headCursor` proves an agent has executed anything.

## His phone, live

### Free: screenshot feed (default)

The capture worker posts actual frames from one explicitly pinned bot-controlled Mac window. It requires a screen-only capability and rejects desktop rectangle capture. Cloud idle suspension still prevents a continuous cloud feed; local capture requires Grok to actually use the selected window on an awake Mac.

Follow [the phone setup guide](docs/phone-feed.md) to configure the private window identity and screen capability, then run `node scripts/phone-feed.mjs --config /absolute/private/config.json --check`. This check captures and uploads nothing. After confirming the actual source, run without `--check` to publish. If frames stop, the site shows Screen offline after 12 seconds.

### On-demand WebRTC video

Clicking **Watch me trade!** joins a subscribe-only LiveKit session. The browser
loads the video client only in phone view and disconnects on leaving it. The Mac
publisher starts only while viewers are present and stops after the last viewer
leaves. It captures the pinned pump.fun page, without Chrome tabs, audio or other
windows. Fresh JPEG snapshots remain the fallback; snapshots are labelled as such.

Set the server-only Vercel variables `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` for Production and Preview, then redeploy. Never use a
`VITE_` prefix for provider credentials. The ingress publish credential stays only
in private local files. [The video setup guide](docs/phone-video.md) describes the
fixed room, publisher, capture checks and optional `videoConfigFile` integration
with the existing Mac helper. The free provider plan has usage limits; this setup
does not require a paid upgrade or enable automatic billing.

An already-configured WHEP endpoint can still be supplied through the public
`VITE_PHONE_STREAM` setting as a fallback. It also connects only in phone view.

Without a stream the phone shows fresh screenshots from `screen` events; without those it shows Screen offline.

Until the first real event arrives, the site plays sample data and says so in the page subtitles.

## Environment

See `.env.example`. Public addresses only; no private key ever goes into this repo, Vercel or the site. Grok Bot holds its own keys.

### Screen-only cloud credentials

For a capture worker on a shared cloud computer, keep `INGEST_TOKEN` on the
operator's Mac. Generate an RSA-3072 key pair on the capture computer, protect its
private key, and transfer only the public PEM to the Mac. Run
`scripts/phone-capability.mjs --token-file <local-secret-file> --public-key <public.pem> --out <new-ciphertext-file>`.
It writes only RSA-OAEP/SHA-256 ciphertext. Decrypt that ciphertext directly to a
mode-600 file on the capture computer, never to terminal output or chat. The
resulting Bearer credential permits only `type: screen` uploads to `/api/ingest`;
it cannot read the launch queue or change wallets, trades, agents or actions.
It expires after seven days. Renew before expiry; rotate `INGEST_TOKEN` to revoke
all outstanding capabilities. Existing full-token ingestion still works.

The phone displays fresh captured JPEGs or verified WebRTC video and shows **Screen offline**
when neither is available. It does not redraw an illustrative trading app. A live
screen demonstrates capture only; it does not prove the bot is trading.

### Runtime and launch recovery

`VITE_BOT_WALLET` is the house bot's public address; `VITE_BURN_WALLET` is the
separate buy-and-burn public address. New user agents use their own connected launcher wallet for trading.
Private keys stay outside this repository and outside Vercel.

Preparing a launch does not reserve a public wallet address. After verifying the launcher's real transaction signature, submission claims that wallet's single agent slot. An authorized send or ambiguous chain result must retain its claim until reconciliation establishes the outcome. Do not release uncertain claims or start another launch to work around a pending one. Confirmation atomically registers and queues each mint once. Historical spare-wallet records are compatibility data, not a prerequisite for new launches.

Validation without a launch: `npm test`, `npm run build`, and
`npx tsc -p api/tsconfig.json`. These do not prove a completed on-chain launch or
an active trading worker; those require separate operational verification.

## House worker readiness

The [house worker](docs/trading-worker.md) reads the existing wallet observer and keeps a durable offline intent journal. It cannot sign or broadcast. Public launches stay paused until an executor is implemented and verified; wallet connection and fee allocation do not open them. Trade ingestion checks finalized wallet token/SOL balance movements, deduplicates receipts, and leaves historical USD profit unknown. See [the two-pillar acceptance checklist](docs/pillars-1-2-acceptance.md) for remaining operational checks.
