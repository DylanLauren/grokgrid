import { createRequire } from 'node:module';
import { lstat, readFile } from 'node:fs/promises';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';

// pump.fun chain adapter shared by buy-and-burn and the trading executor. Reads use finalized commitment. Builders return
// unsigned transactions; signing happens only in the worker, after every gate passes.
const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-sdk');
const BN = require('bn.js');
const { PUMP_SDK, OnlinePumpSdk, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount } = sdk;
const amm = require('@pump-fun/pump-swap-sdk');

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
 * Buy that can spend at most `spendLamports`: the quote is sized so the slippage ceiling
 * lands on the limit. Uses the bonding curve, or the canonical PumpSwap pool once graduated.
 * Both are exact-out buys, so `minTokenUnits` is what the transaction must deliver.
 */
export async function buildBuy(conn, { wallet, mint, spendLamports, slippageBps, tokenProgram, pool = true }) {
  const online = new OnlinePumpSdk(conn), user = new PublicKey(wallet), mintKey = new PublicKey(mint);
  const [global, feeConfig, state] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchBuyState(mintKey, user, tokenProgram)]);
  const quote = new BN((BigInt(spendLamports) * 10000n / BigInt(10000 + slippageBps)).toString());
  let ixs, minTokenUnits;
  // Privy-signed agents can't wrap SOL under their policy, so they skip pool buys.
  if (state.bondingCurve.complete && !pool) return null;
  if (state.bondingCurve.complete) {
    const pooled = await poolBuy(conn, user, mintKey, quote, slippageBps);
    if (!pooled) return null; // migrated somewhere other than a canonical PumpSwap pool
    ({ ixs, minTokenUnits } = pooled);
  }
  else {
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: state.bondingCurve.tokenTotalSupply, bondingCurve: state.bondingCurve, amount: quote, quoteMint: state.bondingCurve.quoteMint });
    if (amount.lten(0)) throw Error('Buy too small');
    ixs = await PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
      associatedUserAccountInfo: state.associatedUserAccountInfo, mint: mintKey, user, amount, solAmount: quote, slippage: slippageBps / 100, tokenProgram });
    minTokenUnits = amount.toString();
  }
  const built = await finish(conn, user, [...priority(), ...ixs]);
  const sim = await conn.simulateTransaction(built.tx, { sigVerify: false, commitment: 'finalized', replaceRecentBlockhash: true });
  if (sim.value.err) throw Object.assign(Error('Buy failed simulation'), { logs: (sim.value.logs || []).slice(-4) });
  return { ...built, minTokenUnits, route: state.bondingCurve.complete ? 'pumpswap' : 'bonding-curve' };
}

async function poolBuy(conn, user, mint, quote, slippageBps) {
  const pool = amm.canonicalPumpPoolPda(mint);
  if (!(await conn.getAccountInfo(pool, 'finalized'))) return null;
  const state = await new amm.OnlinePumpAmmSdk(conn).swapSolanaState(pool, user);
  if (!state.pool.quoteMint.equals(NATIVE_MINT)) throw Error('Pool is not SOL-quoted');
  const { base } = amm.buyQuoteInput({ quote, slippage: slippageBps / 100, baseReserve: state.poolBaseAmount, quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: state.pool.virtualQuoteReserves, baseMintAccount: state.baseMintAccount, baseMint: state.baseMint, coinCreator: state.pool.coinCreator,
    creator: state.pool.creator, feeConfig: state.feeConfig, globalConfig: state.globalConfig, quoteMint: state.pool.quoteMint,
    isMayhemMode: state.pool.isMayhemMode, creatorFeeBps: state.pool.creatorFeeBps });
  if (base.lten(0)) throw Error('Buy too small');
  return { ixs: await amm.PUMP_AMM_SDK.buyQuoteInput(state, quote, slippageBps / 100), minTokenUnits: base.toString() };
}

/**
 * Sell `tokenUnits` for at least `minimumReceiveLamports` (the program enforces the floor).
 * Bonding curve, or the canonical PumpSwap pool once graduated; null if neither exists.
 */
export async function buildSell(conn, { wallet, mint, tokenUnits, minimumReceiveLamports, slippageBps, tokenProgram, unwrap = true }) {
  const online = new OnlinePumpSdk(conn), user = new PublicKey(wallet), mintKey = new PublicKey(mint);
  const [global, state] = await Promise.all([online.fetchGlobal(), online.fetchSellState(mintKey, user, tokenProgram)]);
  const amount = new BN(tokenUnits), floor = new BN(minimumReceiveLamports);
  let ixs, route;
  if (state.bondingCurve.complete) {
    const pool = amm.canonicalPumpPoolPda(mintKey);
    if (!(await conn.getAccountInfo(pool, 'finalized'))) return null;
    const swap = await new amm.OnlinePumpAmmSdk(conn).swapSolanaState(pool, user);
    if (!swap.pool.quoteMint.equals(NATIVE_MINT)) throw Error('Pool is not SOL-quoted');
    ixs = await amm.PUMP_AMM_SDK.sellInstructions(swap, amount, floor); route = 'pumpswap';
    // Without unwrap the proceeds stay as WSOL in the wallet's own account: no CloseAccount.
    if (!unwrap) ixs = ixs.filter(ix => !([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some(p => ix.programId.equals(p)) && ix.data[0] === 9));
  } else {
    // sellInstructions applies `slippage` below `solAmount`; size it so the floor is exactly the minimum.
    const solAmount = new BN((BigInt(minimumReceiveLamports) * 10000n / BigInt(10000 - slippageBps)).toString());
    ixs = await PUMP_SDK.sellInstructions({ global, bondingCurveAccountInfo: state.bondingCurveAccountInfo, bondingCurve: state.bondingCurve,
      mint: mintKey, user, amount, solAmount, slippage: slippageBps / 100, tokenProgram, mayhemMode: state.bondingCurve.isMayhemMode, cashback: state.bondingCurve.isCashbackCoin });
    route = 'bonding-curve';
  }
  const built = await finish(conn, user, [...priority(), ...ixs]);
  const sim = await conn.simulateTransaction(built.tx, { sigVerify: false, commitment: 'finalized', replaceRecentBlockhash: true });
  if (sim.value.err) throw Object.assign(Error('Sell failed simulation'), { logs: (sim.value.logs || []).slice(-4) });
  return { ...built, route };
}

/**
 * What selling `tokenUnits` returns right now, from on-chain reserves on the same route
 * buildSell uses (bonding curve, or canonical PumpSwap pool). Lamports string, or null.
 */
export async function quoteSell(conn, { mint, tokenUnits, tokenProgram }) {
  const online = new OnlinePumpSdk(conn), mintKey = new PublicKey(mint), amount = new BN(tokenUnits);
  const [global, feeConfig, curve] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchBondingCurve(mintKey)]);
  if (!curve.complete) return getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: curve.tokenTotalSupply, bondingCurve: curve, amount }).toString();
  const pool = amm.canonicalPumpPoolPda(mintKey);
  if (!(await conn.getAccountInfo(pool, 'confirmed'))) return null;
  const st = await new amm.OnlinePumpAmmSdk(conn).swapSolanaState(pool, mintKey); // user only selects token accounts; reserves are what we need
  if (!st.pool.quoteMint.equals(NATIVE_MINT)) return null;
  const { uiQuote } = amm.sellBaseInput({ base: amount, slippage: 0, baseReserve: st.poolBaseAmount, quoteReserve: st.poolQuoteAmount, virtualQuoteReserves: st.pool.virtualQuoteReserves,
    globalConfig: st.globalConfig, baseMintAccount: st.baseMintAccount, baseMint: st.baseMint, coinCreator: st.pool.coinCreator, creator: st.pool.creator,
    feeConfig: st.feeConfig, quoteMint: st.pool.quoteMint, isMayhemMode: st.pool.isMayhemMode, creatorFeeBps: st.pool.creatorFeeBps });
  void tokenProgram;
  return uiQuote.toString();
}

/** A real SPL BurnChecked of the wallet's own tokens. Supply drops on chain. */
export async function buildBurn(conn, { wallet, mint, tokenUnits, decimals, tokenProgram }) {
  const owner = new PublicKey(wallet), mintKey = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintKey, owner, false, tokenProgram);
  return finish(conn, owner, [...priority(), createBurnCheckedInstruction(ata, mintKey, owner, BigInt(tokenUnits), decimals, [], tokenProgram)]);
}

/** Loads a wallet key from a private file. The key is never logged or returned to callers outside the worker. */
export async function loadSigner(path, expectedWallet) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw Error('Keypair file must be private and regular');
  const bytes = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw Error('Unsupported keypair file');
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  bytes.fill(0);
  if (signer.publicKey.toBase58() !== expectedWallet) throw Error('Keypair does not match the configured wallet');
  return signer;
}

export const signedSignature = tx => {
  const bs58 = require('bs58');
  return (bs58.default || bs58).encode(tx.signatures[0]);
};
