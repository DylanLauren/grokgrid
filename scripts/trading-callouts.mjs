// Turns reconciled trades into site callouts, exactly once each. The ledger is private;
// a trade the site rejects as unverifiable (4xx) is recorded and not retried.
import { join } from 'node:path';
import { readPrivateText, savePrivateJSON } from './runtime-observation-store.mjs';
import { postTrade, action } from './runtime-ingest.mjs';
import { marketMetrics } from './strategy-data.mjs';
import { readWhys, whyText } from './trade-why.mjs';

export function pendingCallouts(state, ledger) {
  const done = new Set(Object.keys(ledger.posted || {}));
  return state.intents.filter(i => i.state === 'reconciled-confirmed' && i.signature && !done.has(i.signature));
}

export async function postCallouts(root, state, { agent, max = 5, fetchImpl, lookup = marketMetrics, ledgerDir = root } = {}) {
  const file = join(ledgerDir, 'trading-callouts.json');
  let ledger = { version: 1, posted: {} };
  try { ledger = JSON.parse(await readPrivateText(file)); } catch {}
  const todo = pendingCallouts(state, ledger).slice(0, max);
  if (!todo.length) return { posted: 0, pending: 0 };
  let meta = new Map(); try { meta = await lookup([...new Set(todo.map(i => i.mint))]); } catch {}
  const whys = await readWhys(ledgerDir);
  let posted = 0;
  for (const i of todo) {
    const m = meta.get(i.mint);
    const sol = i.side === 'buy' ? i.receipt.spentLamports : i.receipt.receivedLamports;
    const coin = m?.symbol ? '$' + m.symbol : 'a coin', amount = `${(Number(BigInt(sol)) / 1e9).toFixed(3)} SOL`;
    // The strategy's own reason when it recorded one; the plain fill line otherwise.
    const why = whyText(whys.get(i.id), coin);
    const note = why ? `${why} ${amount}.` : `${i.side === 'buy' ? 'bought' : 'sold'} ${coin} for ${amount} · strategy unvalidated`;
    const status = await postTrade(root, { agent, side: i.side, mint: i.mint, sig: i.signature, symbol: m?.symbol, image: m?.image, note }, fetchImpl);
    if (status >= 200 && status < 300) { ledger.posted[i.signature] = { at: Date.now(), outcome: 'posted' }; posted++; await action(root, note, fetchImpl); }
    else if (status >= 400 && status < 500 && status !== 429) ledger.posted[i.signature] = { at: Date.now(), outcome: `rejected-${status}` };
    // 0, 429 and 5xx stay pending and retry next tick.
  }
  await savePrivateJSON(file, ledger);
  return { posted, pending: pendingCallouts(state, ledger).length };
}
