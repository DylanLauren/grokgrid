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

- `src/scene` the room (three.js + react-three-fiber). The bot, his phone, the monitor and the small family bots are live; the room itself is `public/room.glb`.
- `blender/room.py` builds the room in Blender, bakes its lighting and exports `public/room.glb`:
  `python blender/room.py --bake --soften --export --samples 128` (needs the `bpy` package) and `--preview out.png` for a quick render.
- `src/ui` panels: calls, stats, matrix, grid, docs.
- `api/` Vercel functions:
  - `GET /api/feed` the house bot's calls and wallet curve.
  - `GET /api/agents` every bot on the grid with its coin (DexScreener), balances (chain), stats.
  - `POST /api/ingest` where Grok Bot posts what it just did (`Authorization: Bearer $INGEST_TOKEN`). Trade signatures are checked on chain.

Every screen shows a labelled demo until the first real event arrives.

## Environment

See `.env.example`. Public addresses only; no private key ever goes into this repo, Vercel or the site. Grok Bot holds its own keys.
