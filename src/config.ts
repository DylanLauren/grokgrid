// Public addresses only. Fill these in Vercel env as they go live.
export const MAIN_TICKER = import.meta.env.VITE_MAIN_TICKER || 'GRID'
export const MAIN_NAME = 'Grok Grid'
export const MAIN_MINT = import.meta.env.VITE_MAIN_MINT || ''
export const BOT_WALLET = import.meta.env.VITE_BOT_WALLET || ''
export const BURN_WALLET = import.meta.env.VITE_BURN_WALLET || ''
// WHEP playback URL of his phone's live stream (public; the publish URL never goes here)
export const PHONE_STREAM = import.meta.env.VITE_PHONE_STREAM || ''
export const X_HANDLE = import.meta.env.VITE_X_HANDLE || ''

export const buyUrl = () => (MAIN_MINT ? `https://pump.fun/coin/${MAIN_MINT}` : '')
export const solscan = (kind: 'tx' | 'account' | 'token', id: string) => `https://solscan.io/${kind}/${id}`
