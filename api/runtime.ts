import { ingestScope } from './_ingest-auth.js'
import { HOUSE_WALLET, MAIN_MINT } from './_lib.js'

// Control-plane configuration only. Keys and transaction execution stay off Vercel.
export async function GET(req: Request) {
  if (ingestScope(req.headers.get('authorization'), process.env.INGEST_TOKEN || '') !== 'full') {
    return new Response(JSON.stringify({ error: 'unauthorised' }), { status: 401 })
  }
  return Response.json({
    version: 1,
    mode: 'observe-only',
    signingEnabled: false,
    houseWallet: HOUSE_WALLET,
    burnWallet: process.env.VITE_BURN_WALLET || '',
    officialMint: MAIN_MINT,
    // Setting a mint never grants trading permission or enables spending.
    buybackExecutionEnabled: false,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
