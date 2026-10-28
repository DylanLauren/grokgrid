import { Connection, PublicKey } from '@solana/web3.js'
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { ingestScope } from './_ingest-auth.js'
import { MAIN_MINT, RPC } from './_lib.js'

// Read-only readiness route. There is intentionally no POST or signer here.
export async function GET(req: Request) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (ingestScope(req.headers.get('authorization'), process.env.INGEST_TOKEN || '') !== 'full') return reply({ error: 'unauthorised' }, 401)
  const wallet = process.env.VITE_BURN_WALLET || ''
  const base = { wallet, officialMint: MAIN_MINT || null, executionEnabled: false, signingEnabled: false, revenueVerified: false }
  if (!wallet) return reply({ ...base, state: 'awaiting-burn-wallet', balanceLamports: null })
  try {
    const connection = new Connection(RPC, { commitment: 'finalized', disableRetryOnRateLimit: true,
      fetch: (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) }) })
    const balance = await connection.getBalance(new PublicKey(wallet), 'finalized')
    if (!Number.isSafeInteger(balance)) throw Error('Unsafe balance')
    let verified = false
    if (MAIN_MINT) {
      const mintKey = new PublicKey(MAIN_MINT), account = await connection.getAccountInfo(mintKey, 'finalized')
      if (account && [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())) {
        const mint = await getMint(connection, mintKey, 'finalized', account.owner)
        verified = mint.isInitialized && mint.mintAuthority === null && mint.freezeAuthority === null
      }
    }
    return reply({ ...base, observedAt: Date.now(), balanceLamports: String(balance), mintVerified: verified,
      state: !MAIN_MINT ? 'awaiting-official-mint' : !verified ? 'mint-unverified' : 'execution-disabled' })
  } catch { return reply({ ...base, state: 'unavailable', balanceLamports: null }, 503) }
}
