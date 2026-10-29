import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
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

// Connect your own wallet (Phantom), then sign in once so your bot gets a trading wallet that
// is yours. Launching is one approval in Phantom: it creates the coin and funds the bot.
export function AgentWalletSetup(props: AgentWalletSetupProps & { owner: OwnerWallet | null; onOwnerChange: (o: OwnerWallet | null) => void }) {
  const { owner, onOwnerChange } = props
  const [err, setErr] = useState('')
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()
  async function connect() {
    setErr('')
    const w = provider()
    if (!w) return setErr('No Solana wallet found in this browser. Install Phantom, then reload.')
    try { onOwnerChange({ address: await connectWallet(w), wallet: w }) }
    catch (e) { setErr(rejected(e) ? 'Connection cancelled.' : 'Your wallet didn’t connect. Try again.') }
  }
  if (!appId) return <section className="card gd-connect" aria-label="Connect"><p role="status">Connecting opens shortly, before launches do. Nothing to do yet.</p></section>
  return <section className="card gd-connect" aria-label="Connect">
    {!owner ? <>
      <div className="gd-connect-row">
        <div><h2>Connect</h2><p>Connect Phantom. Your bot gets its own trading wallet, and one approval launches its coin and funds it.</p></div>
        <button type="button" className="btn" onClick={() => void connect()}>Connect Phantom</button>
      </div>
      {err && <p role="alert" className="gd-note bad">{err}</p>}
    </> : <>
      <div className="gd-owner mono"><span className="gd-dot" />Phantom {short(owner.address)}<button type="button" className="gd-link" onClick={() => onOwnerChange(null)}>change</button></div>
      <WalletLoadBoundary><Suspense fallback={<p role="status">Connecting…</p>}><PrivyAgentWallet {...props} appId={appId} /></Suspense></WalletLoadBoundary>
    </>}
  </section>
}
