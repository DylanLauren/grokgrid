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
    - `{ "type": "screen", "jpeg": "<base64>" }` a screenshot of his phone (about 390x844, JPEG quality 70, under 330 KB), every 2 to 3 seconds while he trades. While frames keep coming, the phone in the room shows them; when they stop for 12 seconds it falls back to the redrawn app.

Until the first real event arrives, the site plays sample data and says so in the page subtitles.

## Environment

See `.env.example`. Public addresses only; no private key ever goes into this repo, Vercel or the site. Grok Bot holds its own keys.
