import { RPC } from './_lib.js'

const WSOL = 'So11111111111111111111111111111111111111112'
type Balance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
type Transaction = {
  blockTime: number | null
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: Balance[]; postTokenBalances?: Balance[] } | null
  transaction: { signatures?: string[]; message: { accountKeys: { pubkey: string; signer: boolean }[] } }
}
export type Receipt = { ok: true; blockTime: number; tokenAmountRaw: string; tokenDecimals: number; sizeTokens: number; solFlowLamports: string; solFlow: number; verification: 'wallet-balance-movements'; accountingVerified: false } | { ok: false; reason: string; unavailable?: true }
const invalid = (reason: string): Receipt => ({ ok: false, reason })

// Checks actual finalized wallet balance movements. This does not claim historical
// cost basis, realized PnL, pool execution price, or instruction-level swap decoding.
export function inspectTradeReceipt(tx: Transaction | null, wallet: string, mint: string, side: 'buy' | 'sell'): Receipt {
  if (!tx?.meta || tx.meta.err !== null || !Number.isSafeInteger(tx.blockTime) || !tx.blockTime || tx.blockTime <= 0) return invalid('Successful finalized receipt unavailable.')
  const keys = tx.transaction?.message?.accountKeys
  if (!Array.isArray(keys)) return invalid('Receipt accounts unavailable.')
  const ownerIndex = keys.findIndex(k => k.pubkey === wallet && k.signer === true)
  if (ownerIndex < 0 || mint === WSOL) return invalid('Wallet or trade mint mismatch.')
  const { meta } = tx
  const before = meta.preTokenBalances, after = meta.postTokenBalances
  if (!Array.isArray(before) || !Array.isArray(after)) return invalid('Token balance evidence unavailable.')
  for (const rows of [before, after]) {
    const indices = new Set<number>()
    for (const b of rows) {
      if (!Number.isSafeInteger(b.accountIndex) || b.accountIndex < 0 || b.accountIndex >= keys.length || indices.has(b.accountIndex) || !/^\d+$/.test(b.uiTokenAmount?.amount)) return invalid('Invalid token account evidence.')
      indices.add(b.accountIndex)
    }
  }
  for (const b of before) {
    const a = after.find(x => x.accountIndex === b.accountIndex)
    if (a && (a.owner !== b.owner || a.mint !== b.mint || a.uiTokenAmount.decimals !== b.uiTokenAmount.decimals)) return invalid('Token account identity changed.')
  }
  const matching = [...before, ...after].filter(b => b.owner === wallet && b.mint === mint)
  if (!matching.length) return invalid('No owned token balance evidence.')
  const decimals = matching[0].uiTokenAmount.decimals
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || matching.some(b => b.uiTokenAmount.decimals !== decimals || !/^\d+$/.test(b.uiTokenAmount.amount))) return invalid('Invalid token balance evidence.')
  const sum = (rows: Balance[]) => rows.filter(b => b.owner === wallet && b.mint === mint).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n)
  const delta = sum(after) - sum(before)
  const otherMints = new Set([...before, ...after].filter(b => b.owner === wallet && b.mint !== mint && b.mint !== WSOL).map(b => b.mint))
  for (const other of otherMints) {
    const total = (rows: Balance[]) => rows.filter(b => b.owner === wallet && b.mint === other).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n)
    if (total(after) !== total(before)) return invalid('Multiple asset movements need separate review.')
  }
  if ((side === 'buy' && delta <= 0n) || (side === 'sell' && delta >= 0n)) return invalid('Token movement does not match trade side.')
  // Include owned token-account lamports so ATA creation/closure and WSOL wrapping
  // do not look like SOL spend/proceeds. Exclude network fee paid by this wallet.
  const own = new Set([ownerIndex, ...[...before, ...after].filter(b => b.owner === wallet).map(b => b.accountIndex)])
  let native = 0n
  for (const index of own) {
    const pre = meta.preBalances[index], post = meta.postBalances[index]
    if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post) || pre < 0 || post < 0) return invalid('SOL balance evidence unavailable.')
    native += BigInt(post) - BigInt(pre)
  }
  if (ownerIndex === 0) {
    if (!Number.isSafeInteger(meta.fee) || meta.fee < 0) return invalid('Fee evidence unavailable.')
    native += BigInt(meta.fee)
  }
  if ((side === 'buy' && native >= 0n) || (side === 'sell' && native <= 0n)) return invalid('Opposite SOL movement required; other quote currencies are not supported yet.')
  const amount = delta < 0n ? -delta : delta, sol = native < 0n ? -native : native
  const sizeTokens = Number(amount) / 10 ** decimals, solFlow = Number(sol) / 1e9
  if (!Number.isFinite(sizeTokens) || !Number.isFinite(solFlow) || sol > BigInt(Number.MAX_SAFE_INTEGER)) return invalid('Movement exceeds supported numeric range.')
  return { ok: true, blockTime: tx.blockTime, tokenAmountRaw: amount.toString(), tokenDecimals: decimals, sizeTokens, solFlowLamports: sol.toString(), solFlow, verification: 'wallet-balance-movements', accountingVerified: false }
}

export async function verifyTradeReceipt(signature: string, wallet: string, mint: string, side: 'buy' | 'sell'): Promise<Receipt> {
  try {
    const response = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }] }), signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) return { ok: false, reason: 'Receipt provider unavailable.', unavailable: true }
    const body = await response.json() as { result?: Transaction | null; error?: unknown }
    if (body.error || !body.result) return { ok: false, reason: 'Finalized receipt not available yet.', unavailable: true }
    if (body.result.transaction?.signatures?.[0] !== signature) return { ok: false, reason: 'Receipt signature mismatch.' }
    return inspectTradeReceipt(body.result, wallet, mint, side)
  } catch { return { ok: false, reason: 'Receipt provider unavailable.', unavailable: true } }
}
