// Server-only: builds and checks grid bot launches with pump.fun's official SDK.
// The launcher's wallet and a fresh mint key are the only signers. We never hold a key:
// the server builds an unsigned transaction, the browser signs it, the server reads the
// result back off chain. One transaction creates the coin, opens its fee sharing and
// locks the 80/20 split (the admin is revoked, so nobody can change it later).
import { createRequire } from 'node:module'
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import type { Global } from '@pump-fun/pump-sdk'
import { RPC, redis } from './_lib.js'
import { matchesPrepared, tablesFor } from './_verify.js'

// CommonJS avoids the SDK's Anchor ESM named-export problem on Node.
const require = createRequire(import.meta.url)
const sdk = require('@pump-fun/pump-sdk') as typeof import('@pump-fun/pump-sdk')
const BN = require('bn.js') as typeof import('bn.js')
const { PUMP_SDK, GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, feeSharingConfigPda, bondingCurvePda } = sdk

export const SPLIT = { botBps: 8000, burnBps: 2000 } as const
const ALT_KEY = 'gg:launch:alt'

export const connection = () => new Connection(RPC, 'confirmed')
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

function key(value: string, what: string) {
  const k = new PublicKey(value)
  if (k.toBase58() !== value) throw Error(`Bad ${what} address.`)
  return k
}

export const shares = (bot: string, burn: string) => {
  if (bot === burn) throw Error('Fees need two different wallets.')
  return [
    { address: key(bot, 'bot'), shareBps: SPLIT.botBps },
    { address: key(burn, 'burn'), shareBps: SPLIT.burnBps },
  ]
}

// SOL amount typed in the form, as lamports. Empty means no first buy.
export function firstBuyLamports(value: string): bigint {
  if (value === '') return 0n
  if (!/^(0|[1-9]\d{0,1})(\.\d{1,9})?$/.test(value)) throw Error('Use a SOL amount with up to nine decimals.')
  const [whole, fraction = ''] = value.split('.')
  const amount = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
  if (amount > 10_000_000_000n || (amount > 0n && amount < 1_000_000n)) throw Error('First buy must be 0, or between 0.001 and 10 SOL.')
  return amount
}

// A priority fee that lands on a busy network: the 75th percentile paid around pump.fun lately.
async function priorityFee(conn: Connection): Promise<number> {
  try {
    const recent = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: [PUMP_PROGRAM_ID, GLOBAL_PDA] })
    const fees = recent.map((r) => r.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b)
    const p75 = fees.length ? fees[Math.floor(fees.length * 0.75)] : 0
    return Math.min(2_000_000, Math.max(100_000, p75))
  } catch {
    return 200_000
  }
}

// ---- address lookup table ----
// A full launch (create, 80/20 split, first buy) is over Solana's 1,232 byte limit with
// every account written out. The accounts every launch shares go in one frozen lookup
// table. The site's first launch creates it in the same approval; nobody controls it after.

async function sampleKeys(global: Global, burn: PublicKey) {
  const one = async () => {
    const user = Keypair.generate().publicKey
    const mint = Keypair.generate().publicKey
    const bot = Keypair.generate().publicKey
    const ixs = [
      await PUMP_SDK.createV2Instruction({ user, creator: user, mint, name: 'x', symbol: 'X', uri: 'https://x.y', mayhemMode: false, cashback: false, holderReward: false, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID }),
      await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null }),
      await PUMP_SDK.updateFeeShares({ authority: user, mint, currentShareholders: [user], newShareholders: [{ address: bot, shareBps: 8000 }, { address: burn, shareBps: 2000 }], bondingCurveComplete: false }),
      createAssociatedTokenAccountIdempotentInstruction(user, getAssociatedTokenAddressSync(mint, user, false, TOKEN_2022_PROGRAM_ID), user, mint, TOKEN_2022_PROGRAM_ID),
      await PUMP_SDK.getBuyInstructionRaw({ user, mint, creator: feeSharingConfigPda(mint), amount: new BN(1), solAmount: new BN(1), feeRecipient: global.feeRecipient, buybackFeeRecipient: global.buybackFeeRecipients[0], tokenProgram: TOKEN_2022_PROGRAM_ID }),
    ]
    return new Set(ixs.flatMap((ix) => [ix.programId, ...ix.keys.filter((k) => !k.isSigner).map((k) => k.pubkey)]).map((k) => k.toBase58()))
  }
  const [a, b] = [await one(), await one()]
  const shared = [...a].filter((k) => b.has(k))
  const extra = [...global.feeRecipients, global.feeRecipient, ...global.buybackFeeRecipients, burn, PUMP_FEE_PROGRAM_ID].filter((k) => !k.equals(PublicKey.default)).map((k) => k.toBase58())
  return [...new Set([...shared, ...extra])].map((s) => new PublicKey(s))
}

async function loadTable(): Promise<AddressLookupTableAccount | null> {
  const [addr] = await redis(['GET', ALT_KEY])
  if (typeof addr !== 'string') return null
  const res = await connection().getAddressLookupTable(new PublicKey(addr))
  return res.value && res.value.isActive() ? res.value : null
}

async function buildTable(authority: PublicKey, addresses: PublicKey[], blockhash: string) {
  const slot = await connection().getSlot('finalized')
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot: slot })
  const txs: VersionedTransaction[] = []
  for (let i = 0; i < addresses.length; i += 20) {
    const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority, payer: authority, addresses: addresses.slice(i, i + 20) })
    const last = i + 20 >= addresses.length
    const ixs = [...(i === 0 ? [create] : []), extend, ...(last ? [AddressLookupTableProgram.freezeLookupTable({ lookupTable: table, authority })] : [])]
    txs.push(new VersionedTransaction(new TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()))
  }
  // The launch is compiled against the table before it exists; its addresses are known.
  const account = new AddressLookupTableAccount({ key: table, state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses } })
  return { table: table.toBase58(), account, txs }
}

export async function tableReady(table: string, expected: string[]) {
  const conn = connection()
  const [res, slot] = await Promise.all([conn.getAddressLookupTable(new PublicKey(table)), conn.getSlot('confirmed')])
  if (!res.value || res.value.state.authority) return false
  const have = new Set(res.value.state.addresses.map((a) => a.toBase58()))
  return expected.every((a) => have.has(a)) && slot > res.value.state.lastExtendedSlot
}

export const saveTable = (table: string) => redis(['SET', ALT_KEY, table, 'NX'])

// ---- the launch ----

export type Prepared = {
  tx: string
  message: string
  lastValidBlockHeight: number
  setup: { table: string; expected: string[]; txs: string[]; messages: string[] } | null
}

export async function prepareLaunch(o: { launcher: string; mint: string; name: string; ticker: string; uri: string; firstBuy: string; bot: string; burn: string; fundLamports?: bigint }): Promise<Prepared> {
  const user = key(o.launcher, 'wallet')
  const mint = key(o.mint, 'mint')
  if (!PublicKey.isOnCurve(user.toBytes()) || !PublicKey.isOnCurve(mint.toBytes())) throw Error('Wallet and mint must be signing keys.')
  if ([o.launcher, o.bot, o.burn].includes(o.mint)) throw Error('The mint must be a new key.')
  const split = shares(o.bot, o.burn)
  const lamports = firstBuyLamports(o.firstBuy)

  const conn = connection()
  const accounts = await conn.getMultipleAccountsInfoAndContext([GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, mint], 'confirmed')
  const [g, f, existing] = accounts.value
  if (!g?.owner.equals(PUMP_PROGRAM_ID) || !f?.owner.equals(PUMP_FEE_PROGRAM_ID)) throw Error('pump.fun is unavailable right now, try again.')
  if (existing) throw Error('That coin address is taken. Try again for a fresh one.')
  const global = PUMP_SDK.decodeGlobal(g)
  if (!global.initialized || !global.createV2Enabled) throw Error("pump.fun isn't accepting new coins right now.")

  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await priorityFee(conn) }),
    await PUMP_SDK.createV2Instruction({
      user,
      creator: user,
      mint,
      name: o.name,
      symbol: o.ticker,
      uri: o.uri,
      // Each of these takes over creator fees and would break the 80/20 split.
      mayhemMode: false,
      cashback: false,
      holderReward: false,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    }),
    await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null }),
    await PUMP_SDK.updateFeeShares({ authority: user, mint, currentShareholders: [user], newShareholders: split, bondingCurveComplete: false }),
  ]
  // Launched from the owner's own wallet: the same approval funds the bot's trading wallet.
  const fund = o.fundLamports ?? 0n
  if (fund > 0n) {
    if (o.bot === o.launcher) throw Error('A bot funds itself only from a separate owner wallet.')
    ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: key(o.bot, 'bot'), lamports: fund }))
  }

  if (lamports > 0n) {
    const buyback = global.buybackFeeRecipients.find((k) => !k.equals(PublicKey.default))
    if (!buyback) throw Error("pump.fun's fee settings are unavailable, try again.")
    const amount = sdk.getBuyTokenAmountFromSolAmount({ global, feeConfig: PUMP_SDK.decodeFeeConfig(f), mintSupply: null, bondingCurve: null, amount: new BN(lamports.toString()), quoteMint: NATIVE_MINT })
    if (amount.lten(0)) throw Error('First buy is too small.')
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(user, getAssociatedTokenAddressSync(mint, user, false, TOKEN_2022_PROGRAM_ID), user, mint, TOKEN_2022_PROGRAM_ID),
      await PUMP_SDK.getBuyInstructionRaw({ user, mint, creator: feeSharingConfigPda(mint), amount, solAmount: new BN(lamports.toString()), feeRecipient: global.feeRecipient, buybackFeeRecipient: buyback, tokenProgram: TOKEN_2022_PROGRAM_ID }),
    )
  }

  const latest = await conn.getLatestBlockhash({ commitment: 'confirmed', minContextSlot: accounts.context.slot })
  let table = await loadTable()
  let setup: Prepared['setup'] = null
  if (!table) {
    const addresses = await sampleKeys(global, key(o.burn, 'burn'))
    const built = await buildTable(user, addresses, latest.blockhash)
    table = built.account
    setup = { table: built.table, expected: addresses.map((a) => a.toBase58()), txs: built.txs.map((t) => b64(t.serialize())), messages: built.txs.map((t) => b64(t.message.serialize())) }
  }
  const message = new TransactionMessage({ payerKey: user, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message([table])
  const tx = new VersionedTransaction(message)
  let bytes: Uint8Array
  try {
    bytes = tx.serialize()
  } catch {
    throw Error("That coin doesn't fit in one transaction. Shorten the name or skip the first buy.")
  }
  if (bytes.length > 1232 || message.header.numRequiredSignatures !== 2) throw Error('Launch transaction is the wrong shape.')

  if (setup) {
    // The table isn't on chain yet so the launch can't be dry run; check the wallet can pay.
    if ((await conn.getBalance(user, 'confirmed')) < 0.05e9 + Number(lamports) + Number(fund)) throw Error('Not enough SOL in this wallet for the launch and first buy.')
  } else {
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed', replaceRecentBlockhash: true })
    if (sim.value.err) {
      const logs = sim.value.logs ?? []
      console.error('launch simulation', JSON.stringify(sim.value.err), logs.slice(-6))
      throw Error(logs.some((l) => /insufficient lamports|InsufficientFunds/i.test(l)) ? 'Not enough SOL in this wallet for the launch and first buy.' : 'pump.fun rejected this launch in a dry run, try again.')
    }
  }
  return { tx: b64(bytes), message: b64(message.serialize()), lastValidBlockHeight: latest.lastValidBlockHeight, setup }
}

// A SOL-paired curve stores its quote mint as the default key (all 1s), not wrapped SOL.
export const solQuoted = (q: { equals(k: PublicKey): boolean }) => q.equals(PublicKey.default) || q.equals(NATIVE_MINT)

// Reads a launched coin back off chain: 80/20 locked to the right wallets, no fee-diverting modes.
export async function verifyLaunch(mint: string, bot: string, burn: string) {
  const m = key(mint, 'mint')
  const [sharing, curve] = await connection().getMultipleAccountsInfo([feeSharingConfigPda(m), bondingCurvePda(m)], 'confirmed')
  if (!sharing?.owner.equals(PUMP_FEE_PROGRAM_ID) || !curve?.owner.equals(PUMP_PROGRAM_ID)) return { ok: false as const, reason: 'not on chain yet' }
  const c = PUMP_SDK.decodeSharingConfig(sharing)
  const b = PUMP_SDK.decodeBondingCurve(curve)
  const want = shares(bot, burn)
  const splitOk = c.mint.equals(m) && c.adminRevoked && c.shareholders.length === 2 && want.every((w) => c.shareholders.some((s) => s.address.equals(w.address) && s.shareBps === w.shareBps))
  if (!splitOk) return { ok: false as const, reason: "fee split doesn't match" }
  // the coin must be the plain SOL coin we built: no custom creator rate, no holder rewards
  if (!b.creator.equals(feeSharingConfigPda(m)) || b.isMayhemMode || b.isCashbackCoin || b.isHolderReward || !solQuoted(b.quoteMint) || !b.creatorFeeBps.isZero()) return { ok: false as const, reason: "coin settings don't match" }
  return { ok: true as const }
}

async function tablesOf(m: VersionedMessage) {
  const conn = connection()
  const found = await Promise.all(tablesFor(m).map((k) => conn.getAddressLookupTable(k, { commitment: 'confirmed' })))
  return found.flatMap((r) => (r.value ? [r.value] : []))
}

// Sends the signed launch only if it still holds exactly what we built and both keys signed it.
export async function broadcastLaunch(signedB64: string, expectedMessage: string) {
  const raw = Buffer.from(signedB64, 'base64')
  if (raw.length > 1232) throw Error('Transaction too large.')
  const tx = VersionedTransaction.deserialize(raw)
  const expected = VersionedMessage.deserialize(Buffer.from(expectedMessage, 'base64'))
  if (!matchesPrepared(tx.message, expected, await tablesOf(expected))) throw Error("Your wallet changed the launch, so it wasn't sent. Nothing was spent.")
  if (tx.signatures.length !== 2 || tx.signatures.some((s) => s.every((b) => b === 0))) throw Error('The launch is missing a signature.')
  return connection().sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 })
}

// First launch only: sends the signed lookup-table transactions in order.
export async function broadcastSetup(signed: string[], expectedMessages: string[]) {
  if (signed.length !== expectedMessages.length) throw Error('The launch is missing a signature.')
  const conn = connection()
  for (let i = 0; i < signed.length; i++) {
    const raw = Buffer.from(signed[i], 'base64')
    const tx = VersionedTransaction.deserialize(raw)
    if (!matchesPrepared(tx.message, VersionedMessage.deserialize(Buffer.from(expectedMessages[i], 'base64')))) throw Error("Your wallet changed the launch, so it wasn't sent. Nothing was spent.")
    if (tx.signatures.length !== 1 || tx.signatures[0].every((b) => b === 0)) throw Error('The launch is missing a signature.')
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 })
    const res = await conn.confirmTransaction(sig, 'confirmed')
    if (res.value.err) throw Error('The network rejected the launch. Try again.')
  }
}

// Where a sent launch stands. Re-sent on every check until its blockhash expires.
export async function launchProgress(raw: string, signature: string, _lastValidBlockHeight: number): Promise<'landed' | 'failed' | 'expired' | 'pending'> {
  const conn = connection()
  const [st] = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value
  if (st?.err) return 'failed'
  if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return 'landed'
  // Check the actual signed blockhash; wallets can replace the prepared one.
  const tx = VersionedTransaction.deserialize(Buffer.from(raw, 'base64'))
  const valid = await conn.isBlockhashValid(tx.message.recentBlockhash, { commitment: 'confirmed' })
  if (!valid.value) return st ? 'pending' : 'expired'
  await conn.sendRawTransaction(Buffer.from(raw, 'base64'), { skipPreflight: true, maxRetries: 0 }).catch(() => {})
  return 'pending'
}

// A newly prepared lookup table may not exist yet; use the server's own saved list
// to validate the launch before the visitor's setup transactions are broadcast.
export async function validationTables(expectedMessage: string, setup: { table: string; expected: string[] } | null) {
  if (setup) return [new AddressLookupTableAccount({ key: new PublicKey(setup.table), state: {
    deactivationSlot: 18446744073709551615n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
    addresses: setup.expected.map((a) => new PublicKey(a)),
  } })]
  return tablesOf(VersionedMessage.deserialize(Buffer.from(expectedMessage, 'base64')))
}
