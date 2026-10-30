// The official $GRID mint can be configured before the coin exists. Nothing routes its fees or
// buys it until this check passes on chain: a fixed-supply token, created on pump.fun with a
// locked fee-sharing config paying exactly 80% to the treasury and 20% to the burn wallet, from a
// plain SOL bonding curve. Until then every worker that touches $GRID stays idle and says why.
import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint } from '@solana/spl-token';

const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-sdk');
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const DEFAULT_KEY = '11111111111111111111111111111111';

/**
 * Pure verdict from decoded chain state. `sharing` and `curve` are the SDK's decoded accounts
 * (or null), `mint` is { initialized, mintAuthority, freezeAuthority } (or null). Returns the first
 * reason it fails, or 'ok'.
 */
export function officialVerdict({ mint, sharing, sharingPda, curve, expected }) {
  if (!mint) return 'mint-not-on-chain';
  if (!mint.initialized) return 'mint-not-initialized';
  if (mint.mintAuthority !== null || mint.freezeAuthority !== null) return 'mint-or-freeze-authority-set';
  if (!sharing) return 'no-fee-sharing-config';
  if (sharing.adminRevoked !== true) return 'fee-sharing-admin-not-revoked';
  const holders = (sharing.shareholders || []).map(s => [String(s.address), Number(s.shareBps)]);
  const want = [[expected.treasury, 8000], [expected.burn, 2000]];
  if (holders.length !== 2 || !want.every(([a, bps]) => holders.some(([h, b]) => h === a && b === bps))) return 'fee-split-mismatch';
  if (!curve) return 'no-bonding-curve';
  if (String(curve.creator) !== sharingPda) return 'creator-not-fee-sharing-config';
  if (curve.isMayhemMode || curve.isCashbackCoin || curve.isHolderReward) return 'fee-diverting-mode';
  if (![DEFAULT_KEY, NATIVE_MINT.toBase58()].includes(String(curve.quoteMint))) return 'not-sol-quoted';
  if (String(curve.creatorFeeBps ?? '0') !== '0') return 'custom-creator-fee';
  return 'ok';
}

/** Reads the chain and returns { ok, reason, tokenProgram, decimals }. Any read failure is not ok. */
export async function verifyOfficialMint(conn, mint, expected) {
  try {
    const key = new PublicKey(mint), sharingPda = sdk.feeSharingConfigPda(key), curvePda = sdk.bondingCurvePda(key);
    const [mintAcc, sharingAcc, curveAcc] = await conn.getMultipleAccountsInfo([key, sharingPda, curvePda], 'finalized');
    const tokenProgram = mintAcc && [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(mintAcc.owner.toBase58()) ? mintAcc.owner : null;
    let m = null;
    if (tokenProgram) { const info = await getMint(conn, key, 'finalized', tokenProgram); m = { initialized: info.isInitialized, mintAuthority: info.mintAuthority?.toBase58() ?? null, freezeAuthority: info.freezeAuthority?.toBase58() ?? null, decimals: info.decimals }; }
    const sharing = sharingAcc?.owner.toBase58() === PUMP_FEES ? sdk.PUMP_SDK.decodeSharingConfig(sharingAcc) : null;
    const curve = curveAcc?.owner.toBase58() === PUMP ? sdk.PUMP_SDK.decodeBondingCurve(curveAcc) : null;
    const reason = officialVerdict({ mint: m, sharing: sharing && { adminRevoked: sharing.adminRevoked, shareholders: sharing.shareholders.map(s => ({ address: s.address.toBase58(), shareBps: s.shareBps })) },
      sharingPda: sharingPda.toBase58(), curve, expected });
    return { ok: reason === 'ok', reason, tokenProgram, decimals: m?.decimals };
  } catch (e) { return { ok: false, reason: `read-failed:${String(e?.message || e).slice(0, 40)}` }; }
}
