// What Grok Bot's X account should post next. Pure: inputs are the private journals and the
// ledger; every item has a unique ledger key so it posts once. Only reconciled real trades,
// finalized burns and confirmed launches qualify; paper journals are never read.
const DAY = 86_400_000;
const site = s => s.replace(/^https:\/\//, '');
export const previousUtcDay = now => new Date(Math.floor(now / DAY) * DAY - DAY).toISOString().slice(0, 10);
const onDay = (ts, day) => new Date(ts).toISOString().slice(0, 10) === day;

/** Profit on a sell against the average cost of earlier reconciled buys of the same coin, in %. */
export function sellPnlPct(state, sell) {
  let spent = 0n, units = 0n;
  for (const i of state.intents) if (i.state === 'reconciled-confirmed' && i.side === 'buy' && i.mint === sell.mint && i.createdAt <= sell.createdAt) {
    spent += BigInt(i.receipt.spentLamports); units += BigInt(i.receipt.receivedTokenUnits);
  }
  if (units === 0n || spent === 0n) return null;
  const cost = Number(spent) * Number(BigInt(sell.receipt.soldTokenUnits)) / Number(units);
  return cost > 0 ? (Number(BigInt(sell.receipt.receivedLamports)) / cost - 1) * 100 : null;
}

export function planPosts({ journals, buyback, launches, registry, ledger, now, pendingPosts }) {
  const done = ledger.posted || {}, items = [];
  for (const { agent, state } of journals) for (const intent of pendingPosts(state, ledger)) {
    const pnlPct = intent.side === 'sell' ? sellPnlPct(state, intent) : null;
    items.push({ key: intent.signature, kind: 'trade', agent, mint: intent.mint, intent, pnlPct, at: intent.createdAt,
      lamports: intent.side === 'buy' ? intent.receipt.spentLamports : intent.receipt.receivedLamports, notable: intent.side === 'sell' && pnlPct !== null && pnlPct >= 50 });
  }
  for (const c of buyback?.cycles || []) {
    if (c.state !== 'burned' || done[`burn:${c.id}`]) continue;
    const amount = Number(BigInt(c.burn.tokenUnits)) / 1e6;
    items.push({ key: `burn:${c.id}`, kind: 'burn', mint: c.mint, amount, lamports: c.spendLamports, signature: c.burn.signature, at: c.createdAt, notable: true,
      text: (symbol, s) => [`burned ${amount.toLocaleString('en-US')} $${symbol || 'GRID'}, bought back with ${(Number(BigInt(c.spendLamports)) / 1e9).toFixed(3)} SOL of fees`, `tx: solscan.io/tx/${c.burn.signature}`, site(s)].join('\n') });
  }
  for (const a of launches || []) {
    if (done[`launch:${a.id}`]) continue;
    const coin = registry.find(r => r.id === a.id)?.coin;
    items.push({ key: `launch:${a.id}`, kind: 'launch', mint: a.mint, symbol: coin?.symbol, image: null, at: a.queuedAt, notable: true,
      text: (symbol, s) => [`new bot on the grid: $${symbol || '???'}`, `it trades from its own wallet, by its owner's rules`, `pump.fun/coin/${a.mint}`, site(s)].join('\n') });
  }
  const day = previousUtcDay(now), key = `recap:${day}`;
  const active = journals.some(j => j.state.intents.some(i => i.state === 'reconciled-confirmed' && onDay(i.createdAt, day)))
    || (buyback?.cycles || []).some(c => c.state === 'burned' && onDay(c.createdAt, day));
  if (!done[key] && active) items.push({ key, kind: 'recap', day, at: now, text: () => {
    const s = recapStats(journals, buyback, day);
    return [`daily recap ${day}: ${s.trades} trades${s.winRate === null ? '' : `, ${Math.round(s.winRate * 100)}% wins`}, net ${(s.solIn - s.solOut).toFixed(3)} SOL, ${s.burned.toLocaleString('en-US')} $GRID burned`, 'strategy unvalidated · not financial advice', 'grokgrid.fun'].join('\n');
  } });
  return items.sort((a, b) => a.at - b.at);
}

export function recapStats(journals, buyback, day) {
  let trades = 0, wins = 0, sells = 0, solIn = 0, solOut = 0;
  for (const { state } of journals) for (const i of state.intents) {
    if (i.state !== 'reconciled-confirmed' || !onDay(i.createdAt, day)) continue;
    trades++;
    if (i.side === 'buy') solOut += Number(BigInt(i.receipt.spentLamports)) / 1e9;
    else { solIn += Number(BigInt(i.receipt.receivedLamports)) / 1e9; const p = sellPnlPct(state, i); if (p !== null) { sells++; if (p > 0) wins++; } }
  }
  const burned = (buyback?.cycles || []).filter(c => c.state === 'burned' && onDay(c.createdAt, day)).reduce((n, c) => n + Number(BigInt(c.burn.tokenUnits)) / 1e6, 0);
  return { day, trades, winRate: sells ? wins / sells : null, solIn, solOut, burned };
}
