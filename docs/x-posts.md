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
