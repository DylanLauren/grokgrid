import { balances, HOUSE_WALLET, json, MAIN_MINT, markets, rpc } from './_lib.js'
import { burnedTokens, readMint, START_SUPPLY } from './_token.js'

// Public, read-only proof numbers for $GRID: supply and burns from the mint account,
// treasury and burn wallets from the chain, price from DexScreener.
export async function GET() {
  const burnWallet = process.env.VITE_BURN_WALLET || ''
  const [bal, acc, mkt] = await Promise.all([
    balances([HOUSE_WALLET, burnWallet]),
    MAIN_MINT ? rpc<{ value: unknown }>('getAccountInfo', [MAIN_MINT, { encoding: 'jsonParsed', commitment: 'finalized' }]) : Promise.resolve(null),
    MAIN_MINT ? markets([MAIN_MINT]) : Promise.resolve({} as Awaited<ReturnType<typeof markets>>),
  ])
  const mint = readMint(acc?.value ?? null)
  const burned = mint ? burnedTokens(mint) : null
  return json(
    {
      mint: MAIN_MINT || null,
      onChain: !!mint,
      startSupply: Number(START_SUPPLY),
      supply: mint ? Number(BigInt(mint.supply)) / 10 ** mint.decimals : null,
      burned,
      // nobody can mint more or freeze holders
      locked: mint ? mint.mintAuthority === null && mint.freezeAuthority === null : null,
      market: (MAIN_MINT && mkt[MAIN_MINT]) || null,
      treasury: HOUSE_WALLET ? { wallet: HOUSE_WALLET, sol: bal[HOUSE_WALLET] ?? null } : null,
      burnWallet: burnWallet ? { wallet: burnWallet, sol: bal[burnWallet] ?? null } : null,
      checkedAt: Date.now(),
    },
    200,
    15,
  )
}
