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
  - `POST /api/ingest` where Grok Bot posts what it just did (`Authorization: Bearer $INGEST_TOKEN`). Trade signatures are checked on chain. Event types: `trade`, `agent`, `fees`, `wallet`, plus
    - `{ "type": "action", "text": "reading the trader list" }` one line per step he takes; shows on his phone and in the monitor's agent log.
    - `{ "type": "screen", "jpeg": "<base64>" }` a screenshot of his phone (about 390x844, JPEG quality 70, under 330 KB), every 2 to 3 seconds while he trades. While frames keep coming, the phone in the room shows them; when they stop for 12 seconds it shows Screen offline.

## Launching a grid bot

Anyone can launch a bot from the grid page in one wallet approval (Phantom, Solflare or Backpack):

1. The browser makes a fresh mint key and uploads the coin picture (`POST /api/launch/asset`, served at `/i/<mint>`; metadata at `/m/<mint>`).
2. `POST /api/launch/prepare` builds one transaction with pump.fun's SDK: create the coin, open fee sharing, set 80% to the bot's trading wallet and 20% to `VITE_BURN_WALLET`, revoke the admin so the split is permanent, plus an optional first buy. It is simulated before it is returned.
3. The wallet and the mint key sign. `POST /api/launch/send` refuses anything the wallet changed beyond its own priority fee.
4. `POST /api/launch/confirm` reads the coin back off chain and only then adds the bot to the registry (`/api/agents`), with its owner and trading rules.

Trading wallets come from Grok Bot, which makes them and keeps their keys. It posts spare public addresses:
`{ "type": "wallets", "wallets": ["<address>", ...] }` to `/api/ingest`, and polls `GET /api/ingest` (same token) for `free` (spare wallets left) and `launches` (new bots to start trading; their rules are in `/api/agents`).
Launching is open while `VITE_BURN_WALLET` is set and at least one spare wallet is left.

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
separate buy-and-burn public address. Neither belongs in the spare-wallet pool.
Private keys stay outside this repository and outside Vercel.

Only add spare public wallets after a running bot can consume the launch queue
and enforce the configured rules. Wallet inventory alone does not prove runtime
readiness. Prepared launches reserve wallets for 15 minutes. Once an authorized
send starts, the reservation is held until chain reconciliation completes; an
ambiguous error must not recycle the wallet. If lookup-table setup fails before
the launch is sent, the reservation stays held for operator review. Review the
pending record and chain state before releasing it. Confirmation atomically
registers and queues each mint once.

Validation without a launch: `npm test`, `npm run build`, and
`npx tsc -p api/tsconfig.json`. These do not prove a completed on-chain launch or
an active trading worker; those require separate operational verification.

## House worker readiness

The [house worker](docs/trading-worker.md) reads the existing wallet observer and keeps a durable offline intent journal. It cannot sign or broadcast. Public launches stay paused until an executor is implemented and verified; adding spare wallets alone does not open them. Trade ingestion checks finalized wallet token/SOL balance movements, deduplicates receipts, and leaves historical USD profit unknown. See [the two-pillar acceptance checklist](docs/pillars-1-2-acceptance.md) for remaining operational checks.
