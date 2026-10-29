import { createRequire } from 'node:module';
import { lstat, readFile } from 'node:fs/promises';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

// Chain adapter for buy-and-burn. Reads use finalized commitment. Builders return
// unsigned transactions; signing happens only in the worker, after every gate passes.
const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-sdk');
const BN = require('bn.js');
const { PUMP_SDK, OnlinePumpSdk, getBuyTokenAmountFromSolAmount } = sdk;

export const connect = rpcUrl => new Connection(rpcUrl, { commitment: 'finalized', disableRetryOnRateLimit: true,
  fetch: (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }) });

/** The official mint must be a real SPL/Token-2022 mint nobody can mint more of or freeze. */
export async function readMint(conn, mint) {
  const key = new PublicKey(mint), account = await conn.getAccountInfo(key, 'finalized');
  if (!account || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())) return { verified: false };
  const info = await getMint(conn, key, 'finalized', account.owner);
  return { verified: info.isInitialized && info.mintAuthority === null && info.freezeAuthority === null,
    tokenProgram: account.owner, decimals: info.decimals };
}

export async function readWallet(conn, wallet, mint, tokenProgram) {
  const owner = new PublicKey(wallet);
  const [lamports, blockHeight] = await Promise.all([conn.getBalance(owner, 'finalized'), conn.getBlockHeight('finalized')]);
  if (!Number.isSafeInteger(lamports) || !Number.isSafeInteger(blockHeight)) throw Error('Unsafe chain read');
  let tokenUnits = '0';
  if (mint && tokenProgram) {
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), owner, false, tokenProgram);
    const account = await conn.getAccountInfo(ata, 'finalized');
    if (account) tokenUnits = (await conn.getTokenAccountBalance(ata, 'finalized')).value.amount;
  }
  return { lamports: String(lamports), blockHeight, tokenUnits };
}

/** null = not seen; otherwise whether it reached finality and its error. Never throws a guess. */
export async function signatureStatus(conn, signature) {
  const { value: [status] } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
  if (!status) return null;
  return { finalized: status.confirmationStatus === 'finalized', err: status.err ?? null };
}

async function finish(conn, payer, ixs) {
  const latest = await conn.getLatestBlockhash('finalized');
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message();
  return { tx: new VersionedTransaction(message), lastValidBlockHeight: latest.lastValidBlockHeight };
}

const priority = () => [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 })];

/**
 * Bonding-curve buy that can spend at most `spendLamports` (quote sized so the slippage
 * ceiling lands on the limit). A graduated coin returns null: the PumpSwap route is not built yet.
 */
export async function buildBuy(conn, { wallet, mint, spendLamports, slippageBps, tokenProgram }) {
  const online = new OnlinePumpSdk(conn), user = new PublicKey(wallet), mintKey = new PublicKey(mint);
  const [global, feeConfig, state] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchBuyState(mintKey, user, tokenProgram)]);
  if (state.bondingCurve.complete) return null;
  const solAmount = new BN((BigInt(spendLamports) * 10000n / BigInt(10000 + slippageBps)).toString());
  const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount: solAmount, quoteMint: state.bondingCurve.quoteMint });
  if (amount.lten(0)) throw Error('Buy too small');
  const ixs = await PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
    associatedUserAccountInfo: state.associatedUserAccountInfo, mint: mintKey, user, amount, solAmount, slippage: slippageBps / 100, tokenProgram });
  const built = await finish(conn, user, [...priority(), ...ixs]);
  const sim = await conn.simulateTransaction(built.tx, { sigVerify: false, commitment: 'finalized', replaceRecentBlockhash: true });
  if (sim.value.err) throw Object.assign(Error('Buy failed simulation'), { logs: (sim.value.logs || []).slice(-4) });
  return { ...built, minTokenUnits: amount.toString() };
}

/** A real SPL BurnChecked of the wallet's own tokens. Supply drops on chain. */
export async function buildBurn(conn, { wallet, mint, tokenUnits, decimals, tokenProgram }) {
  const owner = new PublicKey(wallet), mintKey = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintKey, owner, false, tokenProgram);
  return finish(conn, owner, [...priority(), createBurnCheckedInstruction(ata, mintKey, owner, BigInt(tokenUnits), decimals, [], tokenProgram)]);
}

/** Loads the burn wallet's key from a private file. The key is never logged or returned to callers outside the worker. */
export async function loadSigner(path, expectedWallet) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw Error('Keypair file must be private and regular');
  const bytes = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw Error('Unsupported keypair file');
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  bytes.fill(0);
  if (signer.publicKey.toBase58() !== expectedWallet) throw Error('Keypair does not match the burn wallet');
  return signer;
}

export const signedSignature = tx => {
  const bs58 = require('bs58');
  return (bs58.default || bs58).encode(tx.signatures[0]);
};
