// Browser wallet plumbing for the launchpad: find the injected wallet, connect, and sign
// the transactions the server built. Keys never leave the wallet.
export type WalletLike = {
  // Phantom resolves with the key; Solflare resolves empty and sets `publicKey` on itself.
  connect: (o?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } } | void>
  publicKey?: { toString(): string } | null
  signTransaction?: <T>(tx: T) => Promise<T>
  signAllTransactions?: <T>(txs: T[]) => Promise<T[]>
}

export function provider(): WalletLike | null {
  const w = window as unknown as { phantom?: { solana?: WalletLike }; solana?: WalletLike; solflare?: WalletLike; backpack?: WalletLike }
  return w.phantom?.solana ?? w.solflare ?? w.backpack ?? w.solana ?? null
}

export async function connectWallet(p: WalletLike, o?: { onlyIfTrusted?: boolean }): Promise<string> {
  const r = await p.connect(o)
  const key = (r && r.publicKey) || p.publicKey
  if (!key) throw new Error('no wallet key')
  return key.toString()
}

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// Phone browsers have no wallet extension: these open this page inside the wallet app's browser.
export function walletLinks() {
  const url = encodeURIComponent(window.location.href)
  const ref = encodeURIComponent(window.location.origin)
  return [
    { name: 'Phantom', href: `https://phantom.app/ul/browse/${url}?ref=${ref}` },
    { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` },
  ]
}

export async function post<T>(url: string, data: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'something broke, try again')
  return json as T
}

export const toB64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
export const rejected = (e: unknown) => e instanceof Error && /reject|denied|cancel|declin/i.test(e.message)
