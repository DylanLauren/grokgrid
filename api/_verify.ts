// Checks that a wallet-signed transaction is the one the server prepared. Wallets often
// rewrite a transaction while signing (their own priority fee and compute budget, Phantom's
// Lighthouse safety checks), so the bytes rarely match exactly. What must not change is the
// fee payer, the signers, and every instruction we built, in order, with the same accounts
// and data. The only extras allowed are compute budget and Lighthouse instructions.
import { createPublicKey, verify } from 'node:crypto'
import { AddressLookupTableAccount, PublicKey, VersionedMessage, VersionedTransaction } from '@solana/web3.js'

const WALLET_EXTRAS = new Set(['ComputeBudget111111111111111111111111111111', 'L2TExMFKdjpN9kozasaurPtfJx5W6SrHvnmTrTxRdzh'])
const CHANGED = "Your wallet changed the launch, so it wasn't sent. Nothing was spent."

type Ix = { program: string; accounts: string[]; data: string }

// Every account a message touches: static keys, then lookup-table writable and readonly keys.
function accountKeys(m: VersionedMessage, tables: AddressLookupTableAccount[]): string[] {
  const statics = m.staticAccountKeys.map((k) => k.toBase58())
  if (!('addressTableLookups' in m) || !m.addressTableLookups.length) return statics
  const writable: string[] = []
  const readonly: string[] = []
  for (const l of m.addressTableLookups) {
    const t = tables.find((x) => x.key.equals(l.accountKey))
    if (!t) throw Error(CHANGED)
    const at = (i: number) => {
      const a = t.state.addresses[i]
      if (!a) throw Error(CHANGED)
      return a.toBase58()
    }
    writable.push(...l.writableIndexes.map(at))
    readonly.push(...l.readonlyIndexes.map(at))
  }
  return [...statics, ...writable, ...readonly]
}

function instructions(m: VersionedMessage, tables: AddressLookupTableAccount[] = []): Ix[] {
  const keys = accountKeys(m, tables)
  return m.compiledInstructions.map((ix) => ({
    program: keys[ix.programIdIndex],
    accounts: ix.accountKeyIndexes.map((i) => keys[i]),
    data: Buffer.from(ix.data).toString('base64'),
  }))
}

const signers = (m: VersionedMessage) => m.staticAccountKeys.slice(0, m.header.numRequiredSignatures).map((k) => k.toBase58())
const core = (ixs: Ix[]) => ixs.filter((ix) => !WALLET_EXTRAS.has(ix.program))
const same = (a: Ix, b: Ix) => a.program === b.program && a.data === b.data && a.accounts.length === b.accounts.length && a.accounts.every((k, i) => k === b.accounts[i])

// True when `signed` keeps the prepared payer, signers and instructions, plus only wallet extras.
export function matchesPrepared(signed: VersionedMessage, expected: VersionedMessage, tables: AddressLookupTableAccount[] = []): boolean {
  const [sa, ea] = [signers(signed), signers(expected)]
  if (sa.length !== ea.length || sa.some((k, i) => k !== ea[i])) return false
  const got = instructions(signed, tables)
  const want = core(instructions(expected, tables))
  if (got.some((ix) => !WALLET_EXTRAS.has(ix.program) && !want.some((w) => same(w, ix)))) return false
  const kept = core(got)
  return kept.length === want.length && kept.every((ix, i) => same(ix, want[i]))
}

export const tablesFor = (m: VersionedMessage) => ('addressTableLookups' in m ? m.addressTableLookups.map((l) => l.accountKey) : []) as PublicKey[]

// Verify authorization before reserving a wallet indefinitely or sending setup.
// This never signs anything; it verifies the visitor's submitted signatures.
export function authorizedLaunch(signedB64: string, expectedMessage: string, tables: AddressLookupTableAccount[] = []): string {
  const raw = Buffer.from(signedB64, 'base64')
  if (raw.length > 1232) throw Error('Transaction too large.')
  const tx = VersionedTransaction.deserialize(raw)
  const expected = VersionedMessage.deserialize(Buffer.from(expectedMessage, 'base64'))
  if (!matchesPrepared(tx.message, expected, tables)) throw Error(CHANGED)
  const got = signers(tx.message), want = signers(expected)
  if (got.length !== 2 || got.length !== want.length || got.some((k, i) => k !== want[i])) throw Error(CHANGED)
  const message = tx.message.serialize()
  for (let i = 0; i < got.length; i++) {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[i].toBuffer()]), format: 'der', type: 'spki' })
    if (!verify(null, message, key, tx.signatures[i])) throw Error('The launch is missing a valid signature.')
  }
  // Solana transaction id is the first signature, encoded as base58.
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes = Buffer.from(tx.signatures[0])
  let n = BigInt('0x' + bytes.toString('hex')), result = ''
  while (n > 0n) { result = alphabet[Number(n % 58n)] + result; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result }
  return result
}
