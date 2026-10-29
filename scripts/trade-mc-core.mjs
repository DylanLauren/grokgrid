// Exact fill of a reconciled trade from its on-chain pump.fun event, and the market cap it implies.
// The event amounts are the pool's own SOL and token amounts: no account rent, no wallet fees.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PUMP_SDK } = require('@pump-fun/pump-sdk');

export const PUMP_SUPPLY_TOKENS = 1_000_000_000; // pump.fun coins have a fixed 1B supply
const str = v => (v?.toBase58 ? v.toBase58() : v?.toString?.(10));

/** { lamports, units } for this intent from the tx's `Program data:` logs, or null. */
export function fillFromLogs(intent, wallet, logs) {
  const units = String(intent.receipt?.receivedTokenUnits ?? intent.receipt?.soldTokenUnits ?? '');
  for (const l of logs || []) {
    if (!l.startsWith('Program data: ')) continue;
    const body = Buffer.from(l.slice(14), 'base64').subarray(8); // skip the 8-byte event discriminator
    const tries = [
      () => { const e = PUMP_SDK.decodeTradeEventBc(body); return str(e.user) === wallet && str(e.mint) === intent.mint && str(e.tokenAmount) === units && e.isBuy === (intent.side === 'buy') ? { lamports: str(e.solAmount), units } : null; },
      () => { const e = PUMP_SDK.decodeBuyEventAmm(body); return intent.side === 'buy' && str(e.user) === wallet && str(e.baseAmountOut) === units ? { lamports: str(e.quoteAmountIn), units } : null; },
      () => { const e = PUMP_SDK.decodeSellEventAmm(body); return intent.side === 'sell' && str(e.user) === wallet && str(e.baseAmountIn) === units ? { lamports: str(e.quoteAmountOut), units } : null; },
    ];
    for (const t of tries) { try { const f = t(); if (f && Number(f.lamports) > 0) return f; } catch {} }
  }
  return null;
}

/** USD market cap implied by a fill: SOL per whole token × supply × SOL/USD. */
export function fillMcUsd(fill, decimals, solUsd) {
  const tokens = Number(fill.units) / 10 ** decimals, sol = Number(fill.lamports) / 1e9;
  if (!(tokens > 0) || !(sol > 0) || !(solUsd > 0)) return null;
  return (sol / tokens) * PUMP_SUPPLY_TOKENS * solUsd;
}
