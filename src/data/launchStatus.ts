export type OwnerState = { state: 'available' | 'reserved' | 'confirmed' | 'review'; mint?: string; agentId?: string }
export type LaunchStatus = { open: boolean; reason: string | null; walletModel: 'launcher'; oneAgentPerWallet: true; ownerState?: OwnerState }
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const unavailableLaunchStatus = (): LaunchStatus => ({ open: false, reason: 'The launchpad could not verify availability. Please try again shortly.', walletModel: 'launcher', oneAgentPerWallet: true })

export function readLaunchStatus(value: unknown, walletRequired = false): LaunchStatus {
  if (!value || typeof value !== 'object') throw Error('Invalid launch status')
  const s = value as Record<string, unknown>
  if (typeof s.open !== 'boolean' || !(s.reason === null || typeof s.reason === 'string') || s.walletModel !== 'launcher' || s.oneAgentPerWallet !== true) throw Error('Invalid launch status')
  let ownerState: OwnerState | undefined
  if (s.ownerState !== undefined) {
    if (!s.ownerState || typeof s.ownerState !== 'object') throw Error('Invalid wallet status')
    const owner = s.ownerState as Record<string, unknown>
    if (!['available', 'reserved', 'confirmed', 'review'].includes(owner.state as string)
      || (owner.mint !== undefined && (typeof owner.mint !== 'string' || !ADDRESS.test(owner.mint)))
      || (owner.agentId !== undefined && (typeof owner.agentId !== 'string' || owner.agentId.length > 128))) throw Error('Invalid wallet status')
    ownerState = owner as OwnerState
  }
  if (walletRequired && !ownerState) throw Error('Missing wallet status')
  const ownerReason = ownerState?.state === 'confirmed' ? 'This wallet already has an agent.'
    : ownerState?.state === 'reserved' ? 'This wallet has a launch awaiting confirmation. Wait for its result before trying again.'
      : ownerState?.state === 'review' ? 'This wallet has an unresolved launch. Its chain result needs review before another attempt.' : null
  return { open: s.open && !ownerReason, reason: ownerReason ?? s.reason as string | null, walletModel: 'launcher', oneAgentPerWallet: true, ownerState }
}

export async function fetchLaunchStatus(launcher = '', signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<LaunchStatus> {
  if (launcher && !ADDRESS.test(launcher)) throw Error('Invalid wallet address')
  const response = await fetcher(`/api/launch/status${launcher ? `?launcher=${encodeURIComponent(launcher)}` : ''}`, { signal, cache: 'no-store' })
  if (!response.ok) throw Error('Launch status unavailable')
  return readLaunchStatus(await response.json(), !!launcher)
}
