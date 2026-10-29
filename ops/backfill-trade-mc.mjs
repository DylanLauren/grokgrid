#!/usr/bin/env node
// One-off: stamp an approximate market cap on every existing house and agent trade the site
// already shows, from each trade's exact on-chain pump.fun fill and today's SOL/USD.
// Dry run by default (prints what it would post); --send posts `tradeMc` ingest events, which the
// site only uses where a trade has no market cap yet. Reads only; never signs.
//   node ops/backfill-trade-mc.mjs [--send]
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fillFromLogs, fillMcUsd } from '../scripts/trade-mc-core.mjs';
import { postTradeMc } from '../scripts/runtime-ingest.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const send = process.argv.includes('--send');
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const { rpcUrl } = await read(join(root, 'observer-config.json'));
async function rpc(method, params) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    return (await r.json()).result;
  }
  return null;
}
const solUsd = (await (await fetch('https://www.grokgrid.fun/api/feed')).json()).solUsd;
const books = [{ agent: 'house', file: join(root, 'trading/trading-journal.json') }];
try { for (const id of await readdir(join(root, 'agents'))) books.push({ agent: id, file: join(root, 'agents', id, 'trading/trading-journal.json') }); } catch {}

const rows = [];
for (const { agent, file } of books) {
  let s; try { s = (await read(file)).state; } catch { continue; }
  for (const i of s.intents.filter(x => x.state === 'reconciled-confirmed' && x.receipt?.signature)) {
    const sig = i.receipt.signature, tx = await rpc('getTransaction', [sig, { maxSupportedTransactionVersion: 0, encoding: 'json', commitment: 'finalized' }]);
    const decimals = tx?.meta?.postTokenBalances?.find(b => b.mint === i.mint)?.uiTokenAmount?.decimals ?? 6;
    const fill = tx ? fillFromLogs(i, s.wallet, tx.meta.logMessages) : null;
    const mcUsd = fill ? fillMcUsd(fill, decimals, solUsd) : null;
    const status = send && mcUsd ? await postTradeMc(root, { agent, sig, mint: i.mint, mcUsd }) : null;
    rows.push({ agent, side: i.side, mint: i.mint.slice(0, 6), sig: sig.slice(0, 10), fillLamports: fill?.lamports ?? null, mcUsd: mcUsd && Math.round(mcUsd), status });
    await sleep(400);
  }
}
console.table(rows);
console.log(JSON.stringify({ solUsd, trades: rows.length, priced: rows.filter(r => r.mcUsd).length, sent: send }));
