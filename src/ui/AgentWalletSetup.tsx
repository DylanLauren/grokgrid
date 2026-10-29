import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { AgentWalletSession } from '../data/agentWallet'
const PrivyAgentWallet = lazy(() => import('./PrivyAgentWallet'))
export interface AgentWalletSetupProps { onWalletChange: (wallet: AgentWalletSession | null) => void }
class WalletLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">Wallet connect could not load. Reload this page to try again.</p> : this.props.children }
}
// One step: connect. Signing in makes the bot's own wallet behind the scenes, and launching
// gives Grok Bot permission to trade it inside fixed limits. No separate wallet setup screen.
export function AgentWalletSetup(props: AgentWalletSetupProps) {
  const [open, setOpen] = useState(false)
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()
  return <section className="card gd-connect" aria-label="Connect">
    {!appId ? <p role="status">Connecting opens shortly, before launches do. Nothing to do yet.</p> : !open ?
      <div className="gd-connect-row">
        <div><h2>Connect</h2><p>Sign in and your bot gets its own wallet. You fund it, it trades, you can withdraw any time.</p></div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>Connect wallet</button>
      </div> :
      <WalletLoadBoundary><Suspense fallback={<p role="status">Connecting…</p>}><PrivyAgentWallet {...props} appId={appId} /></Suspense></WalletLoadBoundary>}
  </section>
}
