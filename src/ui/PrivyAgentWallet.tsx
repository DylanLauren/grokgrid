import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PrivyProvider, usePrivy, useSigners } from '@privy-io/react-auth'
import { defaultSolanaRpcsPlugin, useCreateWallet, useSignTransaction, useWallets } from '@privy-io/react-auth/solana'
import { privyWalletAdapter } from '../data/privyWalletAdapter'
import { canDelegateWallet, embeddedSolanaAccounts, verifyAgentWallet, type WalletReadiness } from '../data/agentWallet'
import type { WalletLike } from '../data/wallet'
import type { AgentWalletSetupProps } from './AgentWalletSetup'

export default function PrivyAgentWallet({ appId, ...props }: AgentWalletSetupProps & { appId: string }) {
  return <PrivyProvider appId={appId} config={{ loginMethods: ['email'], appearance: { theme: 'dark', accentColor: '#40bda6', walletChainType: 'solana-only' }, embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } }, plugins: [defaultSolanaRpcsPlugin()] }}><WalletControls {...props} /></PrivyProvider>
}
function WalletControls({ onWalletChange }: AgentWalletSetupProps) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const { createWallet } = useCreateWallet()
  const { signTransaction } = useSignTransaction()
  const { addSigners, removeSigners } = useSigners()
  const [consent, setConsent] = useState(false)
  const signerId = import.meta.env.VITE_PRIVY_AGENT_SIGNER_ID?.trim()
  const policyId = import.meta.env.VITE_PRIVY_AGENT_POLICY_ID?.trim()
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [checked, setChecked] = useState<{ address: string; readiness: WalletReadiness } | null>(null)
  const accounts = embeddedSolanaAccounts(user?.linkedAccounts ?? [])
  const hasUnreadyWallet = !accounts.length && (user?.linkedAccounts ?? []).some(a => a.type === 'wallet' && a.chainType === 'solana' && a.connectorType === 'embedded')
  const account = authenticated ? accounts.find(a => a.address === selected) ?? accounts[0] : undefined
  const connected = wallets.find(w => w.address === account?.address && 'isPrivyWallet' in w.standardWallet && w.standardWallet.isPrivyWallet === true)
  const current = useRef({ authenticated, address: account?.address, wallet: connected })
  useLayoutEffect(() => { current.current = { authenticated, address: account?.address, wallet: connected } })
  const address = account?.address
  const walletId = account?.walletId
  useEffect(() => {
    const adapter: WalletLike | null = address && connected ? privyWalletAdapter(address,
      () => current.current.authenticated && current.current.address === address && current.current.wallet === connected,
      async transaction => (await signTransaction({ wallet: connected, transaction, chain: 'solana:mainnet' })).signedTransaction) : null
    onWalletChange(address && walletId && adapter ? { address, walletId, wallet: adapter, accessToken: getAccessToken, authorizationReady: checked?.address === address && checked.readiness.walletAuthorizationReady } : null)
    return () => onWalletChange(null)
  }, [address, walletId, connected, signTransaction, checked, onWalletChange, getAccessToken])
  async function act(fn: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await fn() } catch { setMessage('Wallet action did not complete. Check your session and try again. No launch or trade was submitted.') }
    finally { setBusy(false) }
  }
  async function verify() {
    if (!address || !walletId) return
    setChecked(null); setConsent(false)
    const readiness = await verifyAgentWallet(walletId, address, await getAccessToken())
    if (current.current.address !== address) return
    setChecked({ address, readiness }); setMessage(readiness.reason === 'authorization-verified' ? 'Agent permission verified. Trading remains disabled.' : readiness.canAuthorize ? 'Review the approved policy below before granting permission.' : 'Agent permission is not available yet. Wallet setup can continue.')
  }
  if (!ready) return <p role="status">Preparing secure sign-in…</p>
  if (!authenticated) return <button type="button" className="btn" onClick={() => login()}>Sign in to create your wallet</button>
  return <div>
    <p>You control this wallet. Signing in does not grant the agent permission to spend.</p>
    {accounts.length > 1 && <label>Agent wallet <select value={address ?? ''} onChange={e => { setSelected(e.target.value); setChecked(null); setMessage('') }}>{accounts.map(a => <option key={a.walletId} value={a.address}>{a.address}</option>)}</select></label>}
    {!account && hasUnreadyWallet ? <p>This account has a wallet without a verified server wallet ID. Its setup needs review before agent access can be configured.</p> : !account ? <button type="button" className="btn" disabled={busy} onClick={() => void act(async () => { const created = await createWallet(); setSelected(created.wallet.address); setMessage('Wallet created. Verify its setup below. It has not been funded.') })}>Create my Solana agent wallet</button> : <>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); setConsent(false); const created = await createWallet({ createAdditional: true }); setSelected(created.wallet.address); setMessage('Another agent wallet created. No funding or agent permission was added.') })}>Create another agent wallet</button>
      <p className="mono" style={{ overflowWrap: 'anywhere' }}>{address}</p>
      <p>Use this public address when funding from Phantom or another Solana wallet. Check the full address before sending. Only fund it once you’re ready to launch.</p>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { await navigator.clipboard.writeText(address!); setMessage('Public address copied.') })}>Copy funding address</button>
      <button type="button" className="btn ghost" disabled={busy || !connected} onClick={() => void act(verify)}>Verify wallet setup</button>
      {checked && checked.address === address && checked.readiness.canAuthorize ? <div>
        <h3>Agent spending policy</h3><p style={{ whiteSpace: 'pre-wrap' }}>{checked.readiness.policySummary}</p>
        <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} /> I approve this policy for this wallet. I can revoke agent access.</label>
        <button type="button" className="btn" disabled={busy || !consent || !canDelegateWallet(checked.readiness, address, walletId, signerId, policyId)} onClick={() => void act(async () => {
          const reviewed = checked.readiness
          if (!reviewed.canAuthorize || !consent || !address || !walletId) return
          const fresh = await verifyAgentWallet(walletId, address, await getAccessToken())
          if (!canDelegateWallet(fresh, address, walletId, signerId, policyId) || !fresh.canAuthorize || fresh.policySha256 !== reviewed.policySha256 || fresh.policySummary !== reviewed.policySummary || current.current.address !== address) throw Error('Policy changed. Review it again.')
          setChecked(null); setConsent(false)
          await addSigners({ address, signers: [{ signerId: fresh.signerId, policyIds: [fresh.policyId] }] })
          await verify()
        })}>Approve reviewed agent policy</button>
      </div> : <p>Agent permission is unavailable until its spending policy is reviewed. No automatic permission request is made.</p>}
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); await removeSigners({ address: address! }); setMessage('All additional signers removed from this wallet. Trading authorization must be verified again.') })}>Revoke all agent signers</button>
    </>}
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void act(async () => { setChecked(null); onWalletChange(null); await logout() })}>Sign out</button>
    <p role="status" aria-live="polite">{busy ? 'Waiting for wallet action…' : message}</p>
  </div>
}
