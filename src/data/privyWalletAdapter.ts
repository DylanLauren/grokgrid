import { VersionedTransaction } from '@solana/web3.js'
import type { WalletLike } from './wallet'

/** Signing is invoked only by a future explicit launch approval, never during setup. */
export function privyWalletAdapter(address: string, isCurrent: () => boolean, signBytes: (bytes: Uint8Array) => Promise<Uint8Array>): WalletLike {
  const assertCurrent = () => { if (!isCurrent()) throw Error('Agent wallet changed. Verify your selected wallet again.') }
  return {
    publicKey: { toString: () => address },
    connect: async () => { assertCurrent(); return { publicKey: { toString: () => address } } },
    signTransaction: async <T,>(transaction: T): Promise<T> => {
      assertCurrent()
      if (!(transaction instanceof VersionedTransaction) || transaction.message.staticAccountKeys[0]?.toBase58() !== address) throw Error('Unexpected agent-wallet transaction.')
      const original = transaction.message.serialize()
      const signed = VersionedTransaction.deserialize(await signBytes(transaction.serialize()))
      assertCurrent()
      const message = signed.message.serialize()
      if (message.length !== original.length || message.some((byte, i) => byte !== original[i])) throw Error('Wallet changed the launch transaction.')
      return signed as T
    },
  }
}
