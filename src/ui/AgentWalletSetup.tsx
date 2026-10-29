import { Component, lazy, Suspense, useCallback, useRef, useState, type ReactNode } from 'react'
import type { AgentWalletSession } from '../data/agentWallet'
import { connectWallet, provider, rejected, type WalletLike } from '../data/wallet'
const PrivyAgentWallet = lazy(() => import('./PrivyAgentWallet'))
export interface OwnerWallet { address: string; wallet: WalletLike }
export interface AgentWalletSetupProps { onWalletChange: (wallet: AgentWalletSession | null) => void }
class WalletLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">Wallet connect could not load. Reload this page to try again.</p> : this.props.children }
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

// One connect: Phantom signs you in (a free message, no transaction), and that same Phantom is
// the owner that approves the launch. The bot's own trading wallet is made for you.
export function AgentWalletSetup(props: AgentWalletSetupProps & { owner: OwnerWallet | null; onOwnerChange: (o: OwnerWallet | null) => void }) {
  const { owner, onOwnerChange, onWalletChange } = props
  const [started, setStarted] = useState(false)
  const [err, setErr] = useState('')
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()
  const latest = useRef<string | null>(null)
  // Privy already connected Phantom for sign-in, so this reconnect is silent; it gives the
  // launch the same wallet to approve with, and refuses a different Phantom account.
  const onSignedIn = useCallback(async (phantom: string | null) => {
    latest.current = phantom
    setErr('')
    if (!phantom) return onOwnerChange(null)
    const w = provider()
    if (!w) return setErr('No Solana wallet found in this browser. Install Phantom, then reload.')
    try {
      const address = await connectWallet(w, { onlyIfTrusted: true }).catch(() => connectWallet(w))
      if (latest.current !== phantom) return
      if (address !== phantom) { onOwnerChange(null); return setErr(`Phantom is on a different account (${short(address)}) than the one you signed in with (${short(phantom)}). Switch accounts in Phantom, or sign out and sign in again.`) }
      onOwnerChange({ address, wallet: w })
    } catch (e) { if (latest.current === phantom) setErr(rejected(e) ? 'Connection cancelled.' : 'Phantom didn’t respond. Try again.') }
  }, [onOwnerChange])
  const signedIn = useCallback((p: string | null) => void onSignedIn(p), [onSignedIn])
  if (!appId) return <section className="card gd-connect" aria-label="Connect"><p role="status">Connecting opens shortly, before launches do. Nothing to do yet.</p></section>
  return <section className="card gd-connect" aria-label="Connect">
    {!started ? <div className="gd-connect-row">
      <div><h2>Connect</h2><p>Connect Phantom and sign one free message. Your bot gets its own trading wallet, and one approval launches its coin and funds it.</p></div>
      <button type="button" className="btn" onClick={() => { if (!provider()) return setErr('No Solana wallet found in this browser. Install Phantom, then reload.'); setStarted(true) }}>Connect Phantom</button>
    </div> : <>
      {owner && <div className="gd-owner mono"><span className="gd-dot" />Phantom {short(owner.address)}</div>}
      <WalletLoadBoundary><Suspense fallback={<p role="status">Connecting…</p>}><PrivyAgentWallet onWalletChange={onWalletChange} onSignedIn={signedIn} appId={appId} /></Suspense></WalletLoadBoundary>
    </>}
    {err && <p role="alert" className="gd-note bad">{err}</p>}
  </section>
}
