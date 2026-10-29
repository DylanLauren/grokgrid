import type { RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room } from 'livekit-client'

export type LivePhoneState = 'idle' | 'connecting' | 'waiting' | 'playing' | 'unavailable'
const PUBLISHER = 'house-publisher'
const ROOM = 'grokgrid-house'
const TRACK = 'synthesized-camera'
type RetryTimers = { now: () => number; set: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>; clear: (timer: ReturnType<typeof setTimeout>) => void }
type Dependencies = { fetcher?: typeof fetch; loadClient?: () => Promise<typeof import('livekit-client')>; timers?: RetryTimers }
const RETRY_DELAYS = [5_000, 15_000, 30_000, 60_000]
const retryTimers: RetryTimers = { now: Date.now, set: (fn, ms) => setTimeout(fn, ms), clear: (timer) => clearTimeout(timer) }

export function retryAfterMilliseconds(value: string | null, now: number): number {
  if (!value) return 0
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 2_147_483_647) : 0
}

// This coordinator owns retries so an old room is always disposed before a new
// session token is requested. No retry survives leaving the phone view.
export function startLivePhone(video: HTMLVideoElement, onState: (state: LivePhoneState) => void, dependencies: Dependencies = {}) {
  const timers = dependencies.timers ?? retryTimers
  let stopped = false, failures = 0
  let playingSince: number | null = null
  let next: ReturnType<typeof setTimeout> | undefined
  let disposeAttempt: (() => void) | undefined
  const run = () => {
    if (stopped) return
    next = undefined
    disposeAttempt?.()
    disposeAttempt = undefined
    disposeAttempt = startLivePhoneAttempt(video, (state) => {
      if (stopped) return
      if (state === 'playing') {
        if (playingSince === null) playingSince = timers.now()
        else if (timers.now() - playingSince >= 60_000) failures = 0
      } else playingSince = null
      onState(state)
    }, dependencies, (minimumDelay) => {
      if (stopped || next !== undefined) return
      const delay = Math.max(RETRY_DELAYS[Math.min(failures++, RETRY_DELAYS.length - 1)], minimumDelay)
      // Schedule first, so even synchronous disconnect callbacks cannot queue
      // another reconnect or mint another viewer token.
      next = timers.set(run, delay)
      disposeAttempt?.()
    })
    // A test fetcher or an early SDK error can fail synchronously before the
    // disposer assignment above completes. Do not leave its watchdog alive.
    if (next !== undefined) disposeAttempt()
  }
  run()
  return () => {
    stopped = true
    if (next !== undefined) timers.clear(next)
    disposeAttempt?.()
  }
}

export function startVisibleLivePhone(video: HTMLVideoElement, onState: (state: LivePhoneState) => void, dependencies: Dependencies = {}, visibility: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document) {
  let stopped = false
  let dispose: (() => void) | undefined
  const sync = () => {
    if (stopped) return
    if (visibility.visibilityState === 'hidden') {
      dispose?.(); dispose = undefined; onState('idle')
    } else if (!dispose) dispose = startLivePhone(video, onState, dependencies)
  }
  visibility.addEventListener('visibilitychange', sync)
  sync()
  return () => { stopped = true; visibility.removeEventListener('visibilitychange', sync); dispose?.() }
}

export function validPhoneSession(value: unknown): { url: string; token: string; room: string; trackName: string } {
  const session = value as Record<string, unknown> | null
  if (!session || typeof session.url !== 'string' || typeof session.token !== 'string' || session.token.length > 16_384 || !session.token || session.room !== ROOM || session.trackName !== TRACK) throw Error('video-unavailable')
  const url = new URL(session.url)
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('video-unavailable')
  return { url: url.origin, token: session.token, room: ROOM, trackName: TRACK }
}

// Called only by the watching effect. No local media, publication, storage, or
// credentials in logs. The disposer also cancels a still-connecting room.
function startLivePhoneAttempt(video: HTMLVideoElement, onState: (state: LivePhoneState) => void, dependencies: Dependencies, onUnavailable: (minimumDelay: number) => void) {
  const fetcher = dependencies.fetcher ?? fetch
  const loadClient = dependencies.loadClient ?? (() => import('livekit-client'))
  const abort = new AbortController()
  let stopped = false, connected = false
  let room: Room | null = null
  let attached: RemoteTrack | null = null
  let muted = false
  let frameCallback: number | undefined
  let lastFrame = 0
  let minimumRetryDelay = 0
  const update = (state: LivePhoneState) => {
    if (!stopped) { onState(state); if (state === 'unavailable') onUnavailable(minimumRetryDelay) }
  }
  const cancelFrame = () => { if (frameCallback !== undefined) video.cancelVideoFrameCallback?.(frameCallback); frameCallback = undefined }
  const detach = () => {
    cancelFrame()
    attached?.detach(video)
    attached = null
    lastFrame = 0
    video.pause()
    video.srcObject = null
  }
  const watchFrames = () => {
    if (!video.requestVideoFrameCallback || !attached || stopped) return
    frameCallback = video.requestVideoFrameCallback(() => {
      if (stopped || !attached) return
      lastFrame = Date.now()
      if (!muted && connected) update('playing')
      watchFrames()
    })
  }
  const playing = () => { if (attached && !muted && connected && !video.requestVideoFrameCallback) update('playing') }
  const waiting = () => { if (attached) update('waiting') }
  for (const event of ['waiting', 'stalled', 'ended', 'emptied']) video.addEventListener(event, waiting)
  video.addEventListener('playing', playing)
  const watchdog = setInterval(() => { if (attached && lastFrame && Date.now() - lastFrame > 5_000) update('waiting') }, 1_000)
  const timeout = setTimeout(() => abort.abort(), 8_000)
  update('connecting')
  const run = async () => {
    try {
      const response = await fetcher('/api/phone-session', { signal: abort.signal, cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) {
        if (response.status === 429 || response.status === 503) minimumRetryDelay = retryAfterMilliseconds(response.headers.get('retry-after'), (dependencies.timers ?? retryTimers).now())
        throw Error('video-unavailable')
      }
      const session = validPhoneSession(await response.json())
      clearTimeout(timeout)
      if (stopped) return
      if (abort.signal.aborted) throw Error('video-unavailable')
      const client = await loadClient()
      if (stopped) return
      const current = new client.Room({ adaptiveStream: false, dynacast: false })
      room = current
      const allowed = (publication: Pick<RemoteTrackPublication, 'trackName' | 'kind'>, participant: Pick<RemoteParticipant, 'identity'>) => participant.identity === PUBLISHER && publication.trackName === session.trackName && publication.kind === client.Track.Kind.Video
      const subscribe = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (!stopped && allowed(publication, participant)) publication.setSubscribed(true)
      }
      current.on(client.RoomEvent.TrackPublished, subscribe)
      current.on(client.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (stopped || !allowed(publication, participant) || track.kind !== client.Track.Kind.Video) { publication.setSubscribed(false); return }
        if (attached === track) return
        detach()
        attached = track
        muted = publication.isMuted
        track.attach(video)
        update('waiting')
        watchFrames()
        void video.play().catch(() => update('waiting'))
      })
      current.on(client.RoomEvent.TrackUnsubscribed, (track) => { if (track === attached) { detach(); update('waiting') } })
      current.on(client.RoomEvent.TrackSubscriptionFailed, (sid, participant) => {
        const publication = participant.videoTrackPublications.get(sid)
        if (publication && allowed(publication, participant)) {
          connected = false
          detach()
          update('unavailable')
          void current.disconnect().catch(() => {})
        }
      })
      current.on(client.RoomEvent.TrackMuted, (publication, participant) => { if (allowed(publication, participant)) { muted = true; update('waiting') } })
      current.on(client.RoomEvent.TrackUnmuted, (publication, participant) => { if (allowed(publication, participant)) { muted = false; lastFrame = 0; update('waiting') } })
      current.on(client.RoomEvent.Reconnecting, () => { connected = false; update('connecting') })
      current.on(client.RoomEvent.Reconnected, () => { connected = true; update('waiting') })
      current.on(client.RoomEvent.Disconnected, () => { connected = false; detach(); update('unavailable') })
      await current.connect(session.url, session.token, { autoSubscribe: false, websocketTimeout: 10_000, peerConnectionTimeout: 10_000 })
      if (stopped) { await current.disconnect(); return }
      if (current.name !== session.room) throw Error('video-unavailable')
      connected = true
      update('waiting')
      current.remoteParticipants.forEach((participant) => participant.videoTrackPublications.forEach((publication) => subscribe(publication, participant)))
    } catch {
      if (!stopped) {
        connected = false
        detach()
        void room?.disconnect().catch(() => {})
        update('unavailable')
      }
    } finally { clearTimeout(timeout) }
  }
  void run()
  return () => {
    stopped = true
    connected = false
    abort.abort()
    clearTimeout(timeout)
    clearInterval(watchdog)
    for (const event of ['waiting', 'stalled', 'ended', 'emptied']) video.removeEventListener(event, waiting)
    video.removeEventListener('playing', playing)
    detach()
    room?.removeAllListeners()
    void room?.disconnect().catch(() => {})
  }
}
