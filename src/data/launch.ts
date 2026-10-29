// Launches a grid bot from the browser in one wallet approval: the picture is stored, the
// server builds the transaction, the wallet and a fresh mint key sign it, the server sends
// it and reads the coin back off chain before the bot joins the grid.
import { fromB64, post, toB64, type WalletLike } from './wallet'

export const MAX_IMAGE_BYTES = 400_000
export const STEPS = ['saving the picture', 'building the launch', 'approve in your wallet', 'sending to Solana', 'locking the fee split'] as const

export interface LaunchDraft {
  look: number
  name: string
  ticker: string
  description: string
  website: string
  x: string
  telegram: string
  strategy: string
  maxSol: number
  takeProfit: number
  stopLoss: number
  firstBuy: string
}

// Programs a launch may call. Anything else in the transaction means it was tampered with.
const ALLOWED_PROGRAMS = new Set([
  'ComputeBudget111111111111111111111111111111',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun
  'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', // pump.fun fees
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  '11111111111111111111111111111111',
])
const LOOKUP_TABLE_PROGRAM = 'AddressLookupTab1e1111111111111111111111111'

// Squares and shrinks a picture so uploads stay small. GIFs stay animated.
export async function toImage(file: Blob): Promise<string> {
  if (file.type === 'image/gif') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('GIFs must be 400 KB or smaller.')
    return new Promise((ok, no) => {
      const r = new FileReader()
      r.onload = () => ok(r.result as string)
      r.onerror = () => no(new Error('could not read that file'))
      r.readAsDataURL(file)
    })
  }
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const size = Math.min(512, side)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size)
  for (const q of [0.92, 0.8, 0.6]) {
    const url = canvas.toDataURL('image/webp', q)
    const out = url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/png')
    if ((out.length * 3) / 4 <= MAX_IMAGE_BYTES) return out
  }
  throw new Error('That picture is too detailed, try a simpler one.')
}

// The bot drawing (an SVG) as a 512px PNG, since pump.fun and wallets want a raster picture.
export async function svgToImage(svgUrl: string): Promise<string> {
  const img = new Image()
  img.src = svgUrl
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  canvas.getContext('2d')!.drawImage(img, 0, 0, 512, 512)
  return canvas.toDataURL('image/png')
}

export async function launchBot(o: { wallet: WalletLike; launcher: string; walletId: string; accessToken: () => Promise<string | null>; draft: LaunchDraft; image: string; onStep: (i: number) => void }): Promise<{ id: string; mint: string }> {
  const { wallet, launcher, walletId, accessToken, draft, image, onStep } = o
  if (!wallet.signTransaction) throw new Error("This wallet can't sign transactions. Try Phantom, Solflare or Backpack.")
  const { Keypair, PublicKey, VersionedTransaction } = await import('@solana/web3.js')
  // The mint key is made here and never leaves this tab. It signs once, then it's gone.
  const mint = Keypair.generate()
  const mintAddr = mint.publicKey.toBase58()

  onStep(0)
  await post('/api/launch/asset', { mint: mintAddr, image })
  onStep(1)
  const prepared = await post<{ tx: string; setup: string[] | null }>('/api/launch/prepare', { mint: mintAddr, launcher, walletId, draft }, (await accessToken()) ?? undefined)
  const tx = VersionedTransaction.deserialize(fromB64(prepared.tx))
  const keys = tx.message.staticAccountKeys
  const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex].toBase58())
  if (!keys[0].equals(new PublicKey(launcher)) || !keys.some((k) => k.equals(mint.publicKey)) || programs.some((id) => !ALLOWED_PROGRAMS.has(id)))
    throw new Error("The launch didn't match what was asked for, so it wasn't signed.")
  // The site's very first launch also creates the shared lookup table, in the same approval.
  const setup = (prepared.setup ?? []).map((s) => VersionedTransaction.deserialize(fromB64(s)))
  for (const s of setup) {
    const k = s.message.staticAccountKeys
    if (k[0].toBase58() !== launcher || s.message.compiledInstructions.some((ix) => k[ix.programIdIndex].toBase58() !== LOOKUP_TABLE_PROGRAM))
      throw new Error("The launch didn't match what was asked for, so it wasn't signed.")
  }

  onStep(2)
  const all = setup.length && wallet.signAllTransactions ? await wallet.signAllTransactions([...setup, tx]) : [...(await Promise.all(setup.map((s) => wallet.signTransaction!(s)))), await wallet.signTransaction(tx)]
  const signed = all[all.length - 1]
  signed.sign([mint])

  onStep(3)
  await post('/api/launch/send', { mint: mintAddr, tx: toB64(signed.serialize()), setup: all.slice(0, -1).map((s) => toB64(s.serialize())) })

  onStep(4)
  // The server re-sends the launch while it waits and says when it can no longer land.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2500))
    const res = await fetch('/api/launch/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mint: mintAddr }) }).catch(() => null)
    if (!res || res.status === 429 || res.status >= 500) continue
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.id) return { id: j.id, mint: mintAddr }
    if (res.status !== 202) throw new Error(j.error ?? "Couldn't confirm the launch.")
  }
  throw new Error(`Still waiting on Solana. Your bot joins the grid once its coin lands: pump.fun/coin/${mintAddr}`)
}
