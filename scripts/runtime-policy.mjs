export const address = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);

// Pure observation planner: amounts are integer lamport strings, never floats.
export function fundState({ balanceLamports, previousLamports, mint, mintVerified, reserveLamports, thresholdLamports }) {
  const integer = v => typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v);
  if (![balanceLamports, reserveLamports, thresholdLamports].every(integer)) throw Error('Invalid lamport balance or policy');
  const balance = BigInt(balanceLamports), reserve = BigInt(reserveLamports), threshold = BigInt(thresholdLamports);
  if (threshold <= 0n) throw Error('Threshold must be positive');
  const available = balance > reserve ? balance - reserve : 0n;
  const delta = integer(previousLamports) ? balance - BigInt(previousLamports) : null;
  const state = !address(mint) ? 'awaiting-official-mint' : !mintVerified ? 'mint-unverified' : available < threshold ? 'below-threshold' : 'funds-detected-execution-disabled';
  return { state, balanceLamports, availableLamports: available.toString(), balanceChangeLamports: delta?.toString() ?? null,
    // A positive balance delta is not proof of creator-fee revenue.
    revenueVerified: false, signingEnabled: false, executionEnabled: false };
}

export function validateRuntime(config, expectedHouse, expectedBurn) {
  if (config.version !== 1 || config.mode !== 'observe-only' || config.signingEnabled !== false || config.buybackExecutionEnabled !== false) throw Error('Unsupported execution policy');
  if (!address(expectedHouse) || !address(expectedBurn) || expectedHouse === expectedBurn || config.houseWallet !== expectedHouse || config.burnWallet !== expectedBurn) throw Error('Wallet identity mismatch');
  if (config.officialMint && !address(config.officialMint)) throw Error('Invalid mint');
  return config;
}
