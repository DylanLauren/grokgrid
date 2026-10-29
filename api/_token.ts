// $GRID's own numbers, read off the mint account. pump.fun coins start with exactly
// one billion tokens and nobody can mint more once the curve is made, so anything
// missing from the supply has been burned. No reported total is trusted.

export const START_SUPPLY = 1_000_000_000n

export interface MintInfo { supply: string; decimals: number; mintAuthority: string | null; freezeAuthority: string | null }

// getAccountInfo(jsonParsed) of a mint, or null when it is not an SPL mint.
export function readMint(account: unknown): MintInfo | null {
  const a = account as { owner?: string; data?: { parsed?: { type?: string; info?: Record<string, unknown> } } } | null
  if (!a || !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(a.owner ?? '')) return null
  const p = a.data?.parsed
  if (p?.type !== 'mint' || !p.info) return null
  const { supply, decimals, mintAuthority, freezeAuthority } = p.info
  if (typeof supply !== 'string' || !/^\d+$/.test(supply) || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 12) return null
  return { supply, decimals, mintAuthority: typeof mintAuthority === 'string' ? mintAuthority : null, freezeAuthority: typeof freezeAuthority === 'string' ? freezeAuthority : null }
}

// Whole tokens burned so far, or null if the supply is not a pump.fun one.
export function burnedTokens(m: MintInfo): number | null {
  const start = START_SUPPLY * 10n ** BigInt(m.decimals)
  const now = BigInt(m.supply)
  if (now > start) return null
  return Number(start - now) / 10 ** m.decimals
}
