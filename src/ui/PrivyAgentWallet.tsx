import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PrivyProvider, usePrivy, useSigners, type PrivyClientConfig } from '@privy-io/react-auth'
import { defaultSolanaRpcsPlugin, toSolanaWalletConnectors, useCreateWallet, useExportWallet, useSignTransaction, useWallets } from '@privy-io/react-auth/solana'
import { privyWalletAdapter } from '../data/privyWalletAdapter'
import { canDelegateWallet, embeddedSolanaAccounts, verifyAgentWallet, type WalletReadiness } from '../data/agentWallet'
import type { WalletLike } from '../data/wallet'
import type { AgentWalletSetupProps } from './AgentWalletSetup'

// Sign-in is the owner's Phantom: connect it and sign one free message (no transaction).
// One config object for the page's lifetime: a fresh one each render makes Privy re-initialise,
// which re-renders the page, which made a fresh config again (React error 185, an update loop).
const CONFIG = {
  loginMethods: ['wallet'], appearance: { theme: 'dark', accentColor: '#40bda6', walletChainType: 'solana-only', walletList: ['phantom', 'detected_solana_wallets'], showWalletLoginFirst: true },
  externalWallets: { solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) } },
  embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } }, plugins: [defaultSolanaRpcsPlugin()],
} satisfies PrivyClientConfig

export default function PrivyAgentWallet({ appId, onWalletChange, onSignedIn }: AgentWalletSetupProps & { appId: string; onSignedIn: (phantom: string | null) => void }) {
  const props = { onWalletChange, onSignedIn }
  return <PrivyProvider appId={appId} config={CONFIG}><WalletControls {...props} /></PrivyProvider>
}

// Connect, and everything else happens on its own: the bot's wallet is created on first sign-in
// and its setup is checked. The Grok Bot signer is added when the owner presses Launch, after
// the same fresh policy check as before; that press is the owner's approval.
function WalletControls({ onWalletChange, onSignedIn }: AgentWalletSetupProps & { onSignedIn: (phantom: string | null) => void }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const { createWallet } = useCreateWallet()
  const { exportWallet } = useExportWallet()
  const { signTransaction } = useSignTransaction()
  const { addSigners, removeSigners } = useSigners()
  const signerId = import.meta.env.VITE_PRIVY_AGENT_SIGNER_ID?.trim()
  const policyId = import.meta.env.VITE_PRIVY_AGENT_POLICY_ID?.trim()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [checked, setChecked] = useState<{ address: string; readiness: WalletReadiness } | null>(null)
  const accounts = embeddedSolanaAccounts(user?.linkedAccounts ?? [])
  const hasUnreadyWallet = !accounts.length && (user?.linkedAccounts ?? []).some(a => a.type === 'wallet' && a.chainType === 'solana' && a.connectorType === 'embedded')
  const account = authenticated ? accounts[0] : undefined
  const connected = wallets.find(w => w.address === account?.address && 'isPrivyWallet' in w.standardWallet && w.standardWallet.isPrivyWallet === true)
  const current = useRef({ authenticated, address: account?.address, wallet: connected })
  useLayoutEffect(() => { current.current = { authenticated, address: account?.address, wallet: connected } })
  const address = account?.address
  const walletId = account?.walletId
  // the Phantom that signed in is the owner: no second connect
  const phantom = authenticated ? (user?.linkedAccounts ?? []).find((a): a is typeof a & { address: string } => a.type === 'wallet' && a.chainType === 'solana' && a.connectorType !== 'embedded')?.address ?? null : null
  useEffect(() => { onSignedIn(phantom) }, [phantom, onSignedIn])

  const verify = useCallback(async () => {
    if (!address || !walletId) return
    const readiness = await verifyAgentWallet(walletId, address, await getAccessToken())
    if (current.current.address === address) setChecked({ address, readiness })
  }, [address, walletId, getAccessToken])

  // first sign-in: make the bot's wallet without asking
  const creating = useRef(false)
  useEffect(() => {
    if (!authenticated || account || hasUnreadyWallet || creating.current) return
    creating.current = true
    setBusy(true)
    createWallet().catch(() => setMessage('Could not create your bot wallet. Sign out and connect again.')).finally(() => setBusy(false))
  }, [authenticated, account, hasUnreadyWallet, createWallet])

  // check its setup as soon as it is there
  useEffect(() => {
    if (!address || !walletId || !connected || checked?.address === address) return
    verify().catch(() => setMessage('Wallet check is unavailable right now. Launching waits until it passes.'))
  }, [address, walletId, !!connected, checked, verify]) // eslint-disable-line react-hooks/exhaustive-deps

  const authorize = useCallback(async () => {
    if (!address || !walletId) throw Error('Connect your wallet first.')
    const fresh = await verifyAgentWallet(walletId, address, await getAccessToken())
    if (fresh.walletAuthorizationReady) return void setChecked({ address, readiness: fresh })
    if (!canDelegateWallet(fresh, address, walletId, signerId, policyId) || !fresh.canAuthorize || current.current.address !== address) throw Error('Grok Bot’s trading limits could not be confirmed. Nothing was signed; try again shortly.')
    await addSigners({ address, signers: [{ signerId: fresh.signerId, policyIds: [fresh.policyId] }] })
    await verify()
  }, [address, walletId, getAccessToken, signerId, policyId, addSigners, verify])

  const stop = useCallback(async () => {
    if (!address) return
    await removeSigners({ address })
    setChecked(null)
  }, [address, removeSigners])

  // Privy hands back new function objects on many renders; the session reads the latest ones
  // through refs so it is only rebuilt when the wallet or its check actually changes.
  const hasWallet = !!connected
  const fns = useRef({ signTransaction, getAccessToken, authorize, stop })
  useLayoutEffect(() => { fns.current = { signTransaction, getAccessToken, authorize, stop } })
  useEffect(() => {
    const adapter: WalletLike | null = address && hasWallet ? privyWalletAdapter(address,
      () => current.current.authenticated && current.current.address === address && !!current.current.wallet,
      async transaction => (await fns.current.signTransaction({ wallet: current.current.wallet!, transaction, chain: 'solana:mainnet' })).signedTransaction) : null
    const r = checked && address && checked.address === address ? checked.readiness : null
    onWalletChange(address && walletId && adapter ? {
      address, walletId, wallet: adapter, accessToken: () => fns.current.getAccessToken(),
      authorizationReady: !!r?.walletAuthorizationReady,
      authorize: r?.canAuthorize ? () => fns.current.authorize() : undefined,
      policySummary: r?.canAuthorize ? r.policySummary : undefined,
      stop: r?.walletAuthorizationReady ? () => fns.current.stop() : undefined,
    } : null)
    return () => onWalletChange(null)
  }, [address, walletId, hasWallet, checked, onWalletChange])

  async function act(fn: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await fn() } catch { setMessage('That didn’t go through. Nothing was launched or traded.') }
    finally { setBusy(false) }
  }

  // the Connect press that loaded this opens sign-in straight away
  const asked = useRef(false)
  useEffect(() => { if (ready && !authenticated && !asked.current) { asked.current = true; login() } }, [ready, authenticated, login])

  if (!ready) return <p role="status">Connecting…</p>
  if (!authenticated) return <div className="gd-connect-row">
    <div><h2>Sign in with Phantom</h2><p>Sign one free message (not a transaction) so your bot’s trading wallet belongs to you. It never holds your Phantom keys.</p></div>
    <button type="button" className="btn" onClick={() => login()}>Sign in with Phantom</button>
  </div>
  const r = checked && address && checked.address === address ? checked.readiness : null
  return <div className="gd-connect-on">
    <div className="gd-connect-row">
      <div>
        <h2>{address ? 'Ready to launch' : 'Making your bot’s wallet…'}</h2>
        {address && <p>Your bot trades from this wallet. Launching funds it from Phantom in the same approval{r?.walletAuthorizationReady ? '' : ' and lets Grok Bot trade it inside the limits below'}.</p>}
        {!address && hasUnreadyWallet && <p>This account’s wallet needs a manual check before it can trade. Contact us on X.</p>}
      </div>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); onWalletChange(null); onSignedIn(null); await logout() })}>Sign out</button>
    </div>
    {address && <div className="gd-addr">
      <span className="mono"><small>bot wallet</small> {address}</span>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(address); setMessage('Address copied.') })}>Copy</button>
      {/* the key opens in Privy's own window, never on this site; import it into Phantom to move the SOL and coins */}
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { await exportWallet({ address }); setMessage('Import that key in Phantom (Add wallet, Import private key) to move the SOL and coins.') })}>Withdraw</button>
    </div>}
    {r?.canAuthorize && <details className="gd-limits"><summary className="mono">Grok Bot’s limits on this wallet</summary><p style={{ whiteSpace: 'pre-wrap' }}>{r.policySummary}</p>
      {r.walletAuthorizationReady && <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); await removeSigners({ address: address! }); setMessage('Grok Bot can no longer trade this wallet.') })}>Stop Grok Bot trading this wallet</button>}
    </details>}
    <p role="status" aria-live="polite" className="gd-note">{busy ? 'One moment…' : message}</p>
  </div>
}
