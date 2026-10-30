<p align="center"><img src="docs/assets/banner.png" alt="GrokGrid: AI trading bots that launch as coins" width="100%"></p>

<h1 align="center">GrokGrid</h1>

<p align="center">
A Grok Bot trades pump.fun live at his desk. Launch your own bot with its own coin, and it trades from its own wallet.<br>
<a href="https://grokgrid.fun"><b>grokgrid.fun</b></a> · $GRID · buy-and-burn · live phone · receipts on chain
</p>

> Unofficial fan project. Not affiliated with xAI or pump.fun. Nothing here is financial advice: the trading strategy is **unvalidated** and bots can lose money.

## Contents
[What it is](#what-it-is) · [Screens](#screens) · [How it works](#how-it-works) · [Where the money goes](#where-the-money-goes) · [Safety model](#safety-model) · [Architecture](#architecture) · [Status](#status-right-now) · [Run it](#run-it) · [The Mac runtime](#the-mac-runtime) · [API](#api) · [FAQ](#faq) · [Deep dives](#deep-dives) · [Reference](#reference)

## What it is

- **The room.** A 3D desk where the house Grok Bot sits with his phone and monitor. His phone shows his **real pump.fun screen, live** ("Watch me trade!"), and every trade he makes is called out on the site.
- **The grid.** Anyone can launch **their own bot as a coin** on pump.fun. That bot gets its own trading wallet, a trading style (early, momentum or steady) and its owner's limits (max SOL per trade, take-profit, stop-loss). It joins the Grid and Matrix and trades on its own.
- **$GRID.** The main coin. Its creator fees fund the house bot's trading and a **buy-and-burn** that buys $GRID on the market and burns it on chain.
- **Out loud.** Every real trade comes with its reason in plain words ("bought $X: buyers outpacing sellers 2.1×, 410 holders…", "sold $X: took profit at +62%"), built from the numbers the strategy decided on. It posts to the site, the live phone and pump.fun **Callouts** from the GrokGrid profile (X posting is built and off).

## Screens

| | |
|---|---|
| <img src="docs/assets/screens/room.png" alt="The 3D room"> | <img src="docs/assets/screens/grid.png" alt="The Grid"> |
| **The room.** Grok Bot at his desk. Click his phone to watch him trade live. | **The Grid.** Launch a bot: one agent per wallet, every shape and colour. |
| <img src="docs/assets/screens/matrix.png" alt="The Matrix"> | <img src="docs/assets/screens/stats.png" alt="Stats"> |
| **The Matrix.** Every bot on the grid with its coin and stats. | **Stats.** $GRID supply, burns and wallet balances, read straight from the chain. |

<sub>Screenshots of the live site. Until the first real trade or launch, the site shows clearly labelled sample data.</sub>

## How it works

**The house bot ("House Trader").** Grok Bot's wallet trades pump.fun coins. The strategy engine scans coins every minute, screens them and proposes trades. The executor signs at most one trade at a time, writes it to a journal **before** sending it, and settles it from finalized on-chain receipts.
- **Screen:** DexScreener market data plus on-chain checks: no mint or freeze authority, a holder floor, top-10 and creator concentration, liquidity, rising real buyers, and no chasing a coin already up 25% in 5 minutes.
- **Size:** each buy follows the fees the bot actually received and its spendable balance (0.02 SOL per trade until fees reach 1 SOL a day, then 0.05 / 0.1 / 0.5), always inside the hard limits below.
- **Exits:** take-profit, stop-loss, a trailing stop and max hold time. The **exit watcher** re-checks every held coin every 5 seconds from on-chain sell quotes (two checks must agree), so a dump between scans is sold near its stop.
- **The why:** every trade carries the reason it fired, in plain words, on the site, the phone pop-ups, the hover cards and the pump.fun Callout.

**Launching a bot** (one bot per Phantom wallet):
1. Connect **Phantom** and sign one free message. That is the login; it also creates the bot's own **trading wallet** (a Privy embedded wallet tied to that Phantom login) with GrokGrid's **policy-limited** signer: capped pump.fun buys and sells only, no SOL transfers, no key export. Phantom itself is never controlled.
2. Pick the coin (picture, name, ticker, description, socials), the bot (name, its "edge" line, a **trading style**) and limits (max per trade ≤ 0.05 SOL; take-profit and stop-loss can only be tighter than the style's).
3. Choose the **funding** for the bot's trading wallet (minimum 0.05 SOL; 0.02 stays in reserve) and an optional **dev buy** (tokens go to your Phantom; the bot never trades them).
4. Approve **one transaction** in Phantom. It creates the coin on pump.fun with the **80/20 creator-fee split** locked into it (80% to the bot's trading wallet, 20% to the $GRID burn wallet), funds the bot and makes the dev buy.
5. The site reads the coin back from chain, checks the split and settings, and registers the bot on the Grid and Matrix, with its own profile page (the coin's website).
6. The **agent runner** on the Mac picks it up within about 45 seconds and starts trading from the bot's own wallet, with its style, inside the hard limits. Its exits are watched every 5 seconds like the house's.

**Trading styles** (user bots trade coins still on pump.fun's bonding curve):

| Style | Buys | Exits (TP / SL / max hold) |
|---|---|---|
| Early | 3–20 min old, $10k–30k market cap, strong early buying | +35% / −15% / 1 h |
| Momentum | up 5–25% in 5 min on heavy buying, $20k–65k | +45% / −20% / 2 h |
| Steady (default) | 30+ min old, 100+ holders, rising over the hour, $30k–65k | +60% / −25% / 6 h |

Every style keeps the same rug checks (no authorities, top 10 ≤ 30%, dev ≤ 5%, at least 5 SOL in the curve, no chasing a 5-minute pump) and the same money limits. Each ranks passing coins by its own signal, so bots with different styles buy different coins.

**Buy-and-burn.** Once the burn wallet holds 0.05 SOL, it buys $GRID with up to 1 SOL per cycle (5% max slippage). Then it burns **every** $GRID it holds with an SPL `BurnChecked`. It works on the bonding curve or PumpSwap after graduation. It switches on with the official mint (see [Going live with $GRID](#going-live-with-grid)).

**The live phone.** A pinned pump.fun window on the operator's Mac, following House Trader's trades and callouts, is captured as screenshots plus on-demand WebRTC video (LiveKit). Video streams only while someone has "Watch me trade!" open. Trade and callout pop-ups (with MC, P&L and the why) appear over it and fade. If the window isn't capturable, the site says **Screen offline** rather than faking it.

**Callouts and X.**
- **Site:** each reconciled real trade is posted once, with its why.
- **pump.fun:** the GrokGrid profile makes a Callout for every coin the house bot buys, while it holds it (pump.fun's own eligibility check decides), with the why as its thesis.
- **X:** built (trade cards, 7-second clips, daily recap) and off until an X developer app is set up. Paper trades never post anywhere as trades.

## Where the money goes

<img src="docs/assets/money-flow.png" alt="Where the money goes" width="100%">

| Source | Split | Notes |
|---|---|---|
| **$GRID** creator fees | 80% → treasury (the house bot's trading) · 20% → buy-and-burn | Burns are real SPL burns; supply drops on chain |
| Each **bot coin's** creator fees | 80% → that bot's own trading wallet · 20% → the $GRID burn wallet | Written into the coin at launch, verified before it joins the grid |
| A bot's trading money | its own coin fees + what its owner funds at launch | Funds are never pooled between bots |

- **Fee router.** pump.fun only pays a coin's shareholders when someone sends its payout instruction. The fee distributor sends it for $GRID and every bot coin every 10 minutes (the house pays only the network fee), so the 80/20 split actually lands.
- **Matrix fees are read from chain:** each coin's lifetime creator fees = every payout the pump program recorded for it + what waits to be paid out now. Only real pump-program payout events for GrokGrid coins count.
- **$GRID is reserved:** the ticker and lookalike names can't be used by bot launches.

Today the house bot does not move money into other bots; each bot trades only its own wallet.

## Safety model

Everything that can spend money **ships off**. The operator turns each switch on deliberately after a funded test.

- **Hard limits, enforced in code:**
  - House: 0.5 SOL per trade, 1.5 SOL open exposure, a 1.25 SOL daily-loss stop, 15% max slippage, a 0.02 SOL reserve. The fee-tier sizing keeps real trades far below these (0.02 SOL until fees grow).
  - Each user bot: 0.05 SOL per trade (also the Privy signer's per-buy cap), 0.15 SOL open, a 0.125 SOL daily-loss stop, 15% slippage, 0.02 SOL reserve, at most 3 coins. Owners can only tighten.
- **Journal before broadcast:** a transaction's signature is fsync'd to a private journal before it's sent. An outcome that can't be proven is held and **never retried**. Only a passed blockhash with the signature never seen counts as "didn't land".
- **Stop switches:** a `STOP` file freezes all signing on the next tick. An `EXIT` file sells everything and stops buying.
- **Keys:** the house and burn keys are 0600 files on the operator's Mac and never leave it. User bots sign through Privy with a **default-deny policy**: capped curve buys, sells and compute budget, and nothing else. No SOL transfers, no account closes, no key export, no message signing.
- **Fail closed:** missing chain facts fail a screen. Prices are checked against an on-chain quote. Rule changes to a bot after launch are flagged for review, never adopted silently. Launches stay closed until the agent runner is healthy in execute mode **and** the operator opens them.
- **Nothing secret in this repo:** no keys, tokens or private hosts. Public addresses only.

## Architecture

<img src="docs/assets/architecture.png" alt="How GrokGrid fits together" width="100%">

| Piece | Tech | Where |
|---|---|---|
| Site | React 19, Vite, three.js / react-three-fiber, Geist | `src/` (Vercel) |
| API | Vercel functions, Upstash Redis | `api/` |
| Chain | Solana web3.js, SPL Token / Token-2022, pump.fun SDK + PumpSwap SDK | `api/_pump.ts`, `scripts/pump-chain.mjs` |
| Runtime | Node workers under launchd on the operator's Mac | `scripts/`, `ops/launchd/` |
| User wallets | Privy embedded wallets + server signing with a capped policy | `api/_privy-*.ts`, `ops/privy-setup.mjs` |
| Live phone | Native capture helper, JPEG frames, LiveKit WebRTC | `scripts/phone-*`, `docs/phone-*.md` |
| Media | Headless Chrome cards, ffmpeg clips, X API v2 | `scripts/x-*.mjs` |
| 3D room | Blender-baked `public/room.glb` | `blender/room.py` |

## Status right now

| Part | State |
|---|---|
| Site, 3D room, Grid, Matrix, Stats, Docs | Live |
| Live phone | Live while the pinned window is on screen (Mac awake, on power) |
| House trading | **Live**, executing inside the limits above |
| Launches | **Open**: launches stay open while the agent runner is healthy in execute mode |
| User bots | **Live**: trading from their own wallets with their styles |
| Fee router · matrix fees | **Live** for every bot coin; $GRID once minted |
| pump.fun Callouts | **Live** for the house |
| Buy-and-burn | Ready; switches on with the official $GRID mint |
| X posts | Built, off until an X developer app is set up |
| Worker health | `GET /api/status` shows each worker's live heartbeat |

## Run it

```sh
npm install
npm run dev        # the site, with a labelled demo feed
npm test           # unit tests (no network, no signing)
npm run build
npx tsc -p api/tsconfig.json --noEmit
```

The 3D room is built in Blender: `python blender/room.py --bake --soften --export --samples 128` (needs `bpy`), or `--preview out.png` for a quick render.

## The Mac runtime

The workers run from a clean checkout under launchd:

```sh
ops/install-launchd.sh --check   # test, tick every worker once, install nothing
ops/install-launchd.sh           # install / repoint the jobs (prints a one-line revert)
npx tsx ops/go-live.mjs status   # every switch at a glance
```

| Job | What it does | Every |
|---|---|---|
| runtime-observer | Wallet balances, launch outbox, phone heartbeat | 30 s |
| trading-observer | House journal, settlement, executor, site callouts; then watches for planned sells for 25 s | 30 s |
| strategy | Scan, screen, live proposals for the house | 60 s |
| exit-watcher | 5-second exits for the house and every user bot holding a coin | always on |
| agent-runner | Every launched bot: launch outbox, rules, scan, buys, sells, signing via Privy | 45 s |
| fee-distributor | Pays out creator fees 80/20 and posts each coin's lifetime fees to the matrix | 10 min |
| buyback | Buy-and-burn | 30 s |
| pump-callouts | pump.fun Callouts for the house | 5 min |
| x-posts | X posts (off) | 5 min |
| phone-guardian · phone-app · phone-renewal | Keep the live phone window following his trades, the capture app running, its credential fresh | always on · · 30 min |
| log-rotate | Rotates `runtime/logs/<job>.log` over 5 MB | 1 h |
| keep-awake | Keeps the Mac from sleeping | always on |

Going live is one gated command each (`house`, `buyback <mint>`, `runner`, `fees on`, `callouts on`, `x on`). Every one checks keys, funds and setup first and asks for a typed phrase. See [docs/runtime.md](docs/runtime.md).

### Going live with $GRID

1. **Create $GRID on pump.fun** with fee sharing: 80% → `GRDiYB47AKJWsQgFtbvLaVv98rmt5NXbEmWir594QSiT` (treasury, House Trader's wallet) and 20% → `E3TsHC3J3cxi4sPcRa8Rc31ooL2xSuqA7JiQENuTRGXq` (burn wallet), with the fee-sharing admin revoked.
2. **Verify on chain before switching anything:** exactly those two shareholders at 8000 / 2000 bps, admin revoked, the coin's creator is the fee-sharing config, no mint or freeze authority, no mayhem / cashback / holder-reward mode.
3. **Turn on buy-and-burn:** `npx tsx ops/go-live.mjs buyback <mint>` (checks the mint and the burn key, asks for a typed phrase). This sets `officialMint`, so the fee router starts paying $GRID fees out and the house row on the matrix shows $GRID's fees.
4. **Point the site at it:** set `VITE_MAIN_MINT` (and `VITE_MAIN_TICKER` if needed) in Vercel and redeploy, so Stats, the Matrix house row and the room show $GRID.

## API

| Route | What |
|---|---|
| `GET /api/agents` | Every bot on the grid with its coin, balances and stats |
| `GET /api/feed` | The house bot's calls and wallet curve |
| `GET /api/live` · `GET /api/screen` | His latest actions and phone frame |
| `GET /api/status` | Heartbeats per worker (trading, buyback, strategy, agent-runner, phone) |
| `GET /api/token` | $GRID supply, burns and wallets, read from the chain |
| `GET /api/launch/status` | Whether launches are open, and why not |
| `POST /api/launch/{asset,prepare,send,confirm}` | The bot + coin launch flow |
| `POST /api/agent-wallet/readiness` | Read-only check that a wallet's signer and policy are exactly as reviewed |
| `POST /api/ingest` | Authenticated worker events (trades are re-verified on chain) |

## FAQ

**Is this official?** No. It's an unofficial fan project, not affiliated with xAI or pump.fun.

**Will the bots make money?** Unknown. The strategy is unvalidated: research into top pump.fun wallets found no reliable rule, so sizes start small and grow only with real fee income, and every status says so. Bots can lose money.

**Who holds the keys?** The house and burn keys stay on the operator's Mac (0600 files). Each user bot's trading wallet belongs to its owner (a Privy wallet tied to their Phantom login). GrokGrid's signer can only do capped pump.fun trades, and the owner can revoke it any time ("Stop Grok Bot trading this wallet"). Phantom itself is never controlled.

**Why does my bot get its own wallet instead of trading my Phantom?** Phantom only signs when you click Approve, so no server can trade from it while you sleep, and we never take private keys. The bot's wallet holds only what you fund it with plus its fees, so your main wallet is never at risk.

**Does the house bot fund other bots?** Not today. Each bot is funded by its own coin's fees (80%) and its owner's launch funding.

**How many bots can launch?** One bot per Phantom wallet, up to the runner's capacity (`AGENT_CAP`, 100 by default). Launches open only while the runner is healthy.

**Can I write my own strategy?** You pick a style (early, momentum, steady) and can only tighten its limits. The "edge" line is your bot's personality on the grid; every bot trades on the house engine and safety screen.

**What if the Mac sleeps or goes offline?** Workers stop; nothing trades. On restart they resume from their journals. Unresolved trades are settled from the chain before anything new is signed. The site shows each worker's heartbeat.

**How do I stop everything?** `npx tsx ops/go-live.mjs stop` freezes all signing. `exit` sells everything. `off` returns everything to observe-only / paper.

**Is the phone really live?** Yes: it captures the actual pump.fun window. When it can't, the site says **Screen offline**.

## Deep dives

[Strategy](docs/strategy.md) · [Trading worker](docs/trading-worker.md) · [Agent runner](docs/agent-runner.md) · [Buy-and-burn](docs/buyback.md) · [Fee routing](docs/fee-distributor.md) · [Privy agent wallets](docs/privy-agent-wallet.md) · [X posts and media](docs/x-posts.md) · [Runtime and go-live](docs/runtime.md) · [Phone feed](docs/phone-feed.md) · [Phone video](docs/phone-video.md) · [Launch rules](docs/runtime-launch-rules.md) · [Observations](docs/runtime-observations.md)

Art in this README is generated from the site's own mascots and fonts: `npx tsx docs/assets/build.tsx`.

## Reference

### Launching a grid bot

Launches are open while the agent runner is healthy in execute mode and `LAUNCHES_ENABLED=1`. The connected **Phantom** wallet launches the coin and makes the optional dev buy; the bot trades from its **own trading wallet** (a Privy embedded wallet tied to that Phantom login): **one bot per Phantom wallet**.

1. The browser makes a fresh mint key and uploads the coin picture (`POST /api/launch/asset`, served at `/i/<mint>`; metadata at `/m/<mint>`, whose website is the bot's GrokGrid profile).
2. `POST /api/launch/prepare` checks the draft (names and ticker, reserved house/$GRID names refused; funding 0.05–10 SOL; style; limits) and the launcher's balance, then builds one transaction: create the coin, assign 80% of creator fees to the **bot's trading wallet** and 20% to `VITE_BURN_WALLET`, revoke the fee-sharing admin so the split is permanent, fund the bot's wallet, and the optional dev buy. The browser refuses to sign anything that calls programs outside pump.fun and Solana system programs or moves funds anywhere else.
3. Phantom approves the transaction and the mint key signs. `POST /api/launch/send` validates the signed transaction before submission.
4. `POST /api/launch/confirm` reads the coin back from chain (split, admin revoked, creator = the fee-sharing config, a plain SOL-quoted curve, no fee-diverting modes) before atomically registering and queueing the bot with its owner, style and limits.

Pressing **Launch bot** is also the approval for GrokGrid's policy-limited signer on the bot's wallet: capped curve buys, sells and compute budget, nothing else. The owner can revoke it any time. The agent runner signs only through that signer, inside the hard limits.

#### Durable launch observation

`GET /api/launch/events?after=0&limit=50` requires the full `INGEST_TOKEN` and returns an uncached, ordered outbox: `version`, `events`, `nextCursor`, `headCursor`, `hasMore`, `coverage` and `executionEnabled: false`. Each event contains a decimal-string `cursor`, `id`, `mint`, `wallet` and `ts`. The server retains these events; 50 is a page size, not a launch limit. Coverage starts with confirmed launches after outbox deployment, not the project's complete historical activity. Direct `agent` and `wallets` ingest writes are retired; verified launch confirmation is the registration path.

The observer validates each strictly ordered batch (sequence gaps are allowed), stores every event in its private checksum-chained observation journal, fsyncs it, then writes `launch-events-checkpoint.json`. Restart recovery uses the journal's cursor if the checkpoint is missing or behind; a checkpoint ahead of the journal fails closed. Failed or malformed responses never advance the cursor. Failed rule-evidence persistence or a local review-storage capacity limit keeps the full batch journaled but pending replay; retained server events are not skipped. Rule snapshots remain review evidence, not trading authorization.

If the durable endpoint is unavailable, legacy `GET /api/ingest` is a visibly degraded, incomplete latest-window fallback and cannot advance the durable cursor. Intake sends no execution acknowledgement and cannot start trading, sign or broadcast. Neither a captured event nor reaching `headCursor` proves an agent has executed anything.

### His phone, live

#### Free: screenshot feed (default)

The capture worker posts actual frames from one explicitly pinned bot-controlled Mac window. It requires a screen-only capability and rejects desktop rectangle capture. Cloud idle suspension still prevents a continuous cloud feed; local capture requires Grok to actually use the selected window on an awake Mac.

Follow [the phone setup guide](docs/phone-feed.md) to configure the private window identity and screen capability, then run `node scripts/phone-feed.mjs --config /absolute/private/config.json --check`. This check captures and uploads nothing. After confirming the actual source, run without `--check` to publish. If frames stop, the site shows Screen offline after 12 seconds.

#### On-demand WebRTC video

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

### Environment

See `.env.example`. Public addresses only; no private key ever goes into this repo, Vercel or the site. Grok Bot holds its own keys.

#### Screen-only cloud credentials

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

#### Runtime and launch recovery

`VITE_BOT_WALLET` is the house bot's public address; `VITE_BURN_WALLET` is the
separate buy-and-burn public address. User bots trade from their own Privy trading wallets, created at Phantom sign-in.
Private keys stay outside this repository and outside Vercel.

Preparing a launch does not reserve a public wallet address. After verifying the launcher's real transaction signature, submission claims that wallet's single agent slot. An authorized send or ambiguous chain result must retain its claim until reconciliation establishes the outcome. Do not release uncertain claims or start another launch to work around a pending one. Confirmation atomically registers and queues each mint once. Historical spare-wallet records are compatibility data, not a prerequisite for new launches.

Validation without a launch: `npm test`, `npm run build`, and
`npx tsc -p api/tsconfig.json`. These do not prove a completed on-chain launch or
an active trading worker; those require separate operational verification.
