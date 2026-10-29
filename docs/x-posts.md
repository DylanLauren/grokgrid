# Posting trades to X

`scripts/x-post-worker.mjs` posts every real, reconciled house trade to Grok Bot's X account, once each. Paper trades never post.

A post looks like this:

```
bought $COIN for 0.050 SOL
pump.fun/coin/<mint>
tx: solscan.io/tx/<signature>
watch me trade: grokgrid-alpha.vercel.app
```

## Off until you turn it on

The worker posts only when both of these are true:

- `x-config.json` in the runtime folder has `"xPostsEnabled": true`;
- `x-credentials.json` (mode 0600) exists.

`maxPerDay` (default 15) keeps it under X's free tier, which allows about 500 posts a month. A post X rejects is recorded and never retried. A rate limit or outage retries on the next run.

`node scripts/x-post-worker.mjs --dry-run` prints what it would post and sends nothing.

## Credentials (dlao)

1. Create the bot's X account, then a free app at developer.x.com.
2. Set the app's permissions to **Read and write**.
3. Generate the **API Key and Secret** and the **Access Token and Secret** for that account.
4. Save all four into the runtime folder without printing them:

```sh
GG=~/.config/grokgrid/runtime; read -rs -p 'API key: ' A; echo; read -rs -p 'API secret: ' B; echo; read -rs -p 'Access token: ' C; echo; read -rs -p 'Access secret: ' D; echo
(umask 077; printf '{"apiKey":"%s","apiSecret":"%s","accessToken":"%s","accessSecret":"%s"}\n' "$A" "$B" "$C" "$D" > "$GG/x-credentials.json"); unset A B C D; echo saved
```

The keys stay on the Mac. They never go to Vercel or the repo.

The installer runs this worker as `fun.grokgrid.x-posts` every 5 minutes. The pump.fun Callout worker runs as `fun.grokgrid.pump-callouts` on the same schedule, and stays off until `pumpCalloutsEnabled`.

## Media: cards, clips and Grok art

Every post gets a card in the site's style: dark ink, Geist / Geist Mono, green and red only for money, and the white-sphere mascot. The cards are rendered by `scripts/x-media.mjs` from local HTML in a headless system Chrome with a throwaway profile. The only network fetch is the coin picture (https, image types, ≤ 2 MB).

| Post | Media |
|---|---|
| Each real reconciled trade (house and launched bots) | 1200×675 trade card: coin picture, ticker, side, SOL amount, P&L on sells, short tx id |
| Sell at **+50% or better**, a **$GRID burn**, a **new bot launch** | Also a 7 s 1080×1080 silent H.264 clip (the card slides in, the numbers count up). It needs ffmpeg; without it the card is posted |
| Daily recap, first run after 00:00 UTC (only if the previous day had trades or burns) | Recap card: trades, win rate, SOL in/out, $GRID burned, workers online |

- **Upload:** X API v2 chunked upload: `initialize` → `append` in 4 MB chunks → `finalize` → `status` while it processes, all OAuth 1.0a. Query parameters are included in the signature.
- **Fallback:** if any step fails, the post goes out as text only.
- **Dedupe and cap:** everything is deduped in `x-posts.json` (trade signature, `burn:<cycle>`, `launch:<agent>`, `recap:<day>`) under the same 15/day cap. Paper journals are never read.

**Preview:** `node scripts/x-post-worker.mjs --dry-run --render` writes the media to `runtime/x-media-preview/` and posts nothing. With nothing real queued, it renders labelled samples.

**Grok-made art:** `generateArt(prompt)` in `scripts/x-media.mjs` is the hook for images from xAI. It returns null (use the rendered card) until dlao provides an xAI API key. The Grok desktop app's UI is deliberately not automated.
