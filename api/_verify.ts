// Checks that a wallet-signed transaction is the one the server prepared. Wallets often
// rewrite a transaction while signing (their own priority fee and compute budget, Phantom's
// Lighthouse safety checks), so the bytes rarely match exactly. What must not change is the
// fee payer, the signers, and every instruction we built, in order, with the same accounts
// and data. The only extras allowed are compute budget and Lighthouse instructions.
import { AddressLookupTableAccount, PublicKey, VersionedMessage } from '@solana/web3.js'

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
