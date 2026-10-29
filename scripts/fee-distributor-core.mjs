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
