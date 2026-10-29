import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { AgentWalletSession } from '../data/agentWallet'
const PrivyAgentWallet = lazy(() => import('./PrivyAgentWallet'))
export interface AgentWalletSetupProps { onWalletChange: (wallet: AgentWalletSession | null) => void }
class WalletLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">Wallet setup could not load. Reload this page to try again. Launches remain paused.</p> : this.props.children }
}
export function AgentWalletSetup(props: AgentWalletSetupProps) {
  const [open, setOpen] = useState(false)
  const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim()
  return <section className="card" style={{ padding: 24, marginBottom: 24 }} aria-label="Agent wallet setup">
    <h2>Your agent wallet</h2>
    <p>Create a wallet you own before launching. This same address will launch its coin, receive its 80% creator-fee share and trade for that agent. Phantom can fund this address; it is not the agent signer.</p>
    <p>Creating a wallet does not fund it or authorize any spending.</p>
    {!appId ? <p role="status">Agent wallet setup opens shortly, before launches do. Nothing to do yet.</p> : !open ?
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Set up agent wallet</button> :
      <WalletLoadBoundary><Suspense fallback={<p role="status">Loading wallet setup…</p>}><PrivyAgentWallet {...props} appId={appId} /></Suspense></WalletLoadBoundary>}
  </section>
}
