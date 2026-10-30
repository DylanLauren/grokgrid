// Pure rules for the creator-fee distributor (scripts/fee-distributor.mjs). Every GrokGrid coin
// is created with a pump.fun fee-sharing config (bot coins: 80% bot wallet / 20% burn wallet;
// $GRID: treasury / burn). pump.fun only pays shareholders when someone sends the permissionless
// distribute instruction, so this worker sends it from the house wallet, which pays only the
// network fee. It cannot change who gets paid: the program pays the on-chain shareholders.
const address = a => typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const integer = x => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x);

export const PROGRAMS = Object.freeze({
  pump: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  pumpAmm: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  pumpFees: 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
});

export const DEFAULT_DISTRIBUTOR = Object.freeze({
  version: 1, enabled: false,
  minDistributeLamports: '10000000', // 0.01 SOL: fees below this wait for the next run
  maxFeeLamports: '200000',           // most the house may lose to one distribution transaction
  retryMinutes: 30,
});

export function validateDistributorConfig(c) {
  if (!c || c.version !== 1 || typeof c.enabled !== 'boolean' || !integer(c.minDistributeLamports) || !integer(c.maxFeeLamports) || BigInt(c.maxFeeLamports) > 1_000_000n
    || !Number.isSafeInteger(c.retryMinutes) || c.retryMinutes < 5) throw Error('Invalid fee distributor config');
  return c;
}

/** Coins to distribute: the official $GRID mint plus every registered bot coin, deduplicated. */
export function coinsToDistribute(officialMint, registry) {
  const out = new Set();
  if (address(officialMint)) out.add(officialMint);
  for (const a of registry || []) if (!a?.house && address(a?.coin?.mint)) out.add(a.coin.mint);
  return [...out];
}

/** Why not to send for this mint now, or 'ok'. */
export function distributeGate(cfg, state, mint, fee, now) {
  if (!fee) return 'no-fee-sharing';
  if (!fee.canDistribute) return 'below-program-minimum';
  if (BigInt(fee.distributableFees) < BigInt(cfg.minDistributeLamports)) return 'below-threshold';
  const last = state?.mints?.[mint];
  if (last && now - last.at < cfg.retryMinutes * 60000) return 'recently-sent';
  return 'ok';
}

/** Only pump.fun programs and compute budget. What the house pays is checked by simulation. */
export function checkInstructions(ixs) {
  const allowed = new Set(Object.values(PROGRAMS));
  if (!Array.isArray(ixs) || !ixs.length) return 'no-instructions';
  return ixs.some(ix => !allowed.has(ix.programId.toBase58())) ? 'unexpected-program' : 'ok';
}

/** The simulated house balance change must be no worse than the fee allowance. */
export function houseCostOk(preLamports, postLamports, cfg) {
  return Number.isSafeInteger(preLamports) && Number.isSafeInteger(postLamports) && BigInt(preLamports) - BigInt(postLamports) <= BigInt(cfg.maxFeeLamports);
}

// ---- lifetime creator fees, for the matrix ----
// pump.fun emits a DistributeCreatorFeesEvent each time a coin's fee-sharing config pays out, as
// an Anchor self-CPI: an inner instruction to the pump program whose data is an 8-byte event tag
// and then the event. Only those count. "Program data:" log lines are ignored, because any
// program can print one, and an inner instruction counts only if the pump program itself ran it.
// A coin's lifetime creator fees are everything it has paid out plus what waits to be paid out.
const DISTRIBUTE_EVENT = Buffer.from([165, 55, 129, 112, 4, 179, 202, 40]);
const EVENT_IX_TAG = Buffer.from('e445a52e51cb9a1d', 'hex');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = bytes => { let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b) break; s = '1' + s; } return s; };

/** { mint, distributed } from one event body (starting at its discriminator), or null. */
export function parseDistributeEvent(buf) {
  try {
    if (buf.length < 8 + 8 + 128 + 4 || !buf.subarray(0, 8).equals(DISTRIBUTE_EVENT)) return null;
    const mint = b58(buf.subarray(16, 48));
    const n = buf.readUInt32LE(144), at = 148 + n * 34;
    if (n > 16 || buf.length < at + 8) return null;
    const shareholders = Array.from({ length: n }, (_, i) => b58(buf.subarray(148 + i * 34, 180 + i * 34)));
    return { mint, shareholders, distributed: buf.readBigUInt64LE(at) };
  } catch { return null; }
}

/** Every account key of a getTransaction (encoding json) result, lookup-table addresses included. */
const accountKeys = tx => [...(tx?.transaction?.message?.accountKeys || []), ...(tx?.meta?.loadedAddresses?.writable || []), ...(tx?.meta?.loadedAddresses?.readonly || [])];

/**
 * Payouts in one transaction (getTransaction, encoding json): mint -> lamports, for events the
 * pump program emitted whose shareholders include `burn` (GrokGrid coins only).
 */
export function payoutsIn(tx, burn, decode58) {
  const out = new Map();
  if (!tx?.meta || tx.meta.err) return out;
  const keys = accountKeys(tx);
  for (const g of tx.meta.innerInstructions || []) for (const ix of g.instructions || []) {
    if (keys[ix.programIdIndex] !== PROGRAMS.pump) continue;
    let d; try { d = Buffer.from(decode58(ix.data)); } catch { continue; }
    if (d.length <= 16 || !d.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
    const e = parseDistributeEvent(d.subarray(8));
    if (e && e.shareholders.includes(burn)) out.set(e.mint, (out.get(e.mint) ?? 0n) + e.distributed);
  }
  return out;
}

/**
 * Which signatures to read this run. `sigs` is newest first (getSignaturesForAddress).
 * Anyone can put a coin's fee-sharing config into a transaction, so a run reads at most
 * `budget` of them, oldest first, and the cursor only moves past what was read.
 */
export function nextBatch(sigs, budget) {
  const unread = sigs.filter(x => !x.err).reverse();
  return unread.slice(0, Math.max(0, budget));
}

/** Lifetime fees in SOL (rounded to 1e-6), or null when the undistributed part is unknown. */
export function lifetimeFeesSol(distributedLamports, distributableLamports) {
  if (distributableLamports === null || distributableLamports === undefined) return null;
  return Math.round(Number(BigInt(distributedLamports) + BigInt(distributableLamports)) / 1e3) / 1e6;
}
