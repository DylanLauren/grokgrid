import { useEffect, useState } from 'react'
import type { Feed, Live } from '../data/types'
import { FRESH_MS } from '../data/useLive'
import { PHONE_STREAM } from '../config'
import { useWhep } from './useWhep'
import { useLivePhone } from './useLivePhone'
import type { LivePhoneState } from './livePhoneSession'
import { fetchPhoneFrame } from './phoneFrame'
import { PhoneTrades } from './PhoneTrades'
import './phone.css'

// Show only actual broadcast frames. An offline feed must never impersonate a live screen.
export function PhoneScreen({ feed, live, watching }: { feed: Feed; live: Live; watching: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  const { video: liveVideo, state: videoState, playing: livePlaying } = useLivePhone(watching)
  const { video, playing } = useWhep(PHONE_STREAM, watching && videoState === 'unavailable')
  const fallbackPlaying = watching && videoState === 'unavailable' && playing
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="ph-wrap">
      <div className="ph-snapshot" aria-hidden={livePlaying || fallbackPlaying}>
        <Stream ts={live.screenTs} now={now} watching={watching} videoState={videoState} />
      </div>
      <div className={`ph ph-stream ph-video ${livePlaying ? 'on' : ''}`} aria-hidden={!livePlaying}>
        <div className="ph-viewport"><video ref={liveVideo} muted playsInline autoPlay /></div>
        <span className="ph-live mono"><i aria-hidden="true" />live video</span>
      </div>
      {PHONE_STREAM && (
        <div className={`ph ph-stream ph-video ${fallbackPlaying ? 'on' : ''}`} aria-hidden={!fallbackPlaying}>
          <div className="ph-viewport">
            <video ref={video} muted playsInline autoPlay />
          </div>
          <span className="ph-live mono"><i aria-hidden="true" />live video</span>
        </div>
      )}
      <PhoneTrades feed={feed} />
    </div>
  )
}

// Real frames from his phone. The next frame loads behind the current one, then swaps in,
// so the screen never flashes blank.
function Stream({ ts, now, watching, videoState }: { ts: number; now: number; watching: boolean; videoState: LivePhoneState }) {
  const [frame, setFrame] = useState<{ ts: number; src: string } | null>(null)
  useEffect(() => {
    let active = true
    let pendingSrc: string | null = null
    let committed = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    const img = new Image()
    const load = async () => {
      try {
        const next = await fetchPhoneFrame(controller.signal)
        if (!active) return
        const src = URL.createObjectURL(next.blob)
        pendingSrc = src
        img.onload = () => {
          if (active && Date.now() >= next.ts && Date.now() - next.ts < FRESH_MS) {
            committed = true
            setFrame({ ts: next.ts, src })
          } else {
            URL.revokeObjectURL(src)
            pendingSrc = null
          }
        }
        img.onerror = () => { URL.revokeObjectURL(src); pendingSrc = null }
        img.src = src
      } catch {
        // Keep only the previous successfully decoded frame until its own expiry.
      } finally { window.clearTimeout(timeout) }
    }
    void load()
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
      img.onload = null
      img.onerror = null
      if (pendingSrc && !committed) URL.revokeObjectURL(pendingSrc)
    }
  }, [ts, watching])
  useEffect(() => () => { if (frame) URL.revokeObjectURL(frame.src) }, [frame])
  if (!frame || now < frame.ts || now - frame.ts >= FRESH_MS) return <Offline videoState={videoState} />
  return (
    <div className="ph ph-stream">
      <div className="ph-viewport">
        <img src={frame.src} alt="Grok Bot’s captured working browser" />
      </div>
      <span className="ph-live mono"><i aria-hidden="true" />{snapshotLabel(videoState)}</span>
    </div>
  )
}

function snapshotLabel(state: LivePhoneState) {
  if (state === 'connecting') return 'Connecting video · snapshot'
  if (state === 'waiting') return 'Waiting for video · snapshot'
  if (state === 'unavailable') return 'Video unavailable · snapshot'
  return 'Screen snapshot'
}

function Offline({ videoState }: { videoState: LivePhoneState }) {
  return (
    <div className="ph ph-offline" role="status">
      <img src="/brands/grokbot.svg" width={48} height={48} alt="" />
      <strong>{videoState === 'idle' ? 'Watch me trade!' : videoState === 'connecting' ? 'Connecting live video' : videoState === 'waiting' ? 'Waiting for live video' : 'Screen offline'}</strong>
      <span>{videoState === 'idle' ? 'Open the phone to connect to the live screen.' : videoState === 'unavailable' ? 'Video unavailable. Waiting for a fresh screen snapshot.' : 'The working browser appears here when available.'}</span>
    </div>
  )
}
