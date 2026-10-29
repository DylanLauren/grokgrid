import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PrivyProvider, usePrivy, useSigners } from '@privy-io/react-auth'
import { defaultSolanaRpcsPlugin, useCreateWallet, useSignTransaction, useWallets } from '@privy-io/react-auth/solana'
import { privyWalletAdapter } from '../data/privyWalletAdapter'
import { canDelegateWallet, embeddedSolanaAccounts, verifyAgentWallet, type WalletReadiness } from '../data/agentWallet'
import type { WalletLike } from '../data/wallet'
import type { AgentWalletSetupProps } from './AgentWalletSetup'

export default function PrivyAgentWallet({ appId, ...props }: AgentWalletSetupProps & { appId: string }) {
  return <PrivyProvider appId={appId} config={{ loginMethods: ['email', 'google'], appearance: { theme: 'dark', accentColor: '#40bda6', walletChainType: 'solana-only' }, embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } }, plugins: [defaultSolanaRpcsPlugin()] }}><WalletControls {...props} /></PrivyProvider>
}

// Connect, and everything else happens on its own: the bot's wallet is created on first sign-in
// and its setup is checked. The Grok Bot signer is added when the owner presses Launch, after
// the same fresh policy check as before; that press is the owner's approval.
function WalletControls({ onWalletChange }: AgentWalletSetupProps) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const { createWallet } = useCreateWallet()
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
  }, [address, walletId, connected, checked, verify])

  const authorize = useCallback(async () => {
    if (!address || !walletId) throw Error('Connect your wallet first.')
    const fresh = await verifyAgentWallet(walletId, address, await getAccessToken())
    if (fresh.walletAuthorizationReady) return void setChecked({ address, readiness: fresh })
    if (!canDelegateWallet(fresh, address, walletId, signerId, policyId) || !fresh.canAuthorize || current.current.address !== address) throw Error('Grok Bot’s trading limits could not be confirmed. Nothing was signed; try again shortly.')
    await addSigners({ address, signers: [{ signerId: fresh.signerId, policyIds: [fresh.policyId] }] })
    await verify()
  }, [address, walletId, getAccessToken, signerId, policyId, addSigners, verify])

  useEffect(() => {
    const adapter: WalletLike | null = address && connected ? privyWalletAdapter(address,
      () => current.current.authenticated && current.current.address === address && current.current.wallet === connected,
      async transaction => (await signTransaction({ wallet: connected, transaction, chain: 'solana:mainnet' })).signedTransaction) : null
    const r = checked?.address === address ? checked.readiness : null
    onWalletChange(address && walletId && adapter ? {
      address, walletId, wallet: adapter, accessToken: getAccessToken,
      authorizationReady: !!r?.walletAuthorizationReady,
      authorize: r?.canAuthorize ? authorize : undefined,
      policySummary: r?.canAuthorize ? r.policySummary : undefined,
    } : null)
    return () => onWalletChange(null)
  }, [address, walletId, connected, signTransaction, checked, onWalletChange, getAccessToken, authorize])

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
    <div><h2>Connect</h2><p>Sign in and your bot gets its own wallet. You fund it, it trades, you can withdraw any time.</p></div>
    <button type="button" className="btn" onClick={() => login()}>Connect wallet</button>
  </div>
  const r = checked?.address === address ? checked.readiness : null
  return <div className="gd-connect-on">
    <div className="gd-connect-row">
      <div>
        <h2>{address ? 'Connected' : 'Making your bot’s wallet…'}</h2>
        {address && <p>Fund your Grok Bot by sending SOL to this address from Phantom or any wallet. {r?.walletAuthorizationReady ? 'Grok Bot can trade it inside its limits.' : 'Launching lets Grok Bot trade it inside the limits below.'}</p>}
        {!address && hasUnreadyWallet && <p>This account’s wallet needs a manual check before it can trade. Contact us on X.</p>}
      </div>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); onWalletChange(null); await logout() })}>Disconnect</button>
    </div>
    {address && <div className="gd-addr">
      <span className="mono">{address}</span>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(address); setMessage('Address copied.') })}>Copy</button>
    </div>}
    {r?.canAuthorize && <details className="gd-limits"><summary className="mono">Grok Bot’s limits on this wallet</summary><p style={{ whiteSpace: 'pre-wrap' }}>{r.policySummary}</p>
      {r.walletAuthorizationReady && <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); await removeSigners({ address: address! }); setMessage('Grok Bot can no longer trade this wallet.') })}>Stop Grok Bot trading this wallet</button>}
    </details>}
    <p role="status" aria-live="polite" className="gd-note">{busy ? 'One moment…' : message}</p>
  </div>
}
