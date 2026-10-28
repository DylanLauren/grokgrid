import { useEffect, useState } from 'react'
import type { Feed, Live } from '../data/types'
import { FRESH_MS } from '../data/useLive'
import { PHONE_STREAM } from '../config'
import { useWhep } from './useWhep'
import { fetchPhoneFrame } from './phoneFrame'
import './phone.css'

// Show only actual broadcast frames. An offline feed must never impersonate a live screen.
export function PhoneScreen({ live, watching }: { feed: Feed; live: Live; watching: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  const { video, playing } = useWhep(PHONE_STREAM, watching)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const frames = !!live.screenTs && now >= live.screenTs && now - live.screenTs < FRESH_MS
  return (
    <div className="ph-wrap">
      {frames ? <Stream ts={live.screenTs} now={now} /> : <Offline />}
      {PHONE_STREAM && (
        <div className={`ph ph-stream ph-video ${playing ? 'on' : ''}`}>
          <video ref={video} muted playsInline autoPlay />
          <span className="ph-live mono"><i />live</span>
        </div>
      )}
    </div>
  )
}

// Real frames from his phone. The next frame loads behind the current one, then swaps in,
// so the screen never flashes blank.
function Stream({ ts, now }: { ts: number; now: number }) {
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
  }, [ts])
  useEffect(() => () => { if (frame) URL.revokeObjectURL(frame.src) }, [frame])
  if (!frame || now < frame.ts || now - frame.ts >= FRESH_MS) return <Offline />
  return (
    <div className="ph ph-stream">
      <img src={frame.src} alt="Grok Bot's captured screen" />
      <span className="ph-live mono"><i />screen feed</span>
    </div>
  )
}

function Offline() {
  return (
    <div className="ph ph-offline" role="status">
      <img src="/brands/grokbot.svg" width={48} height={48} alt="" />
      <strong>Screen offline</strong>
      <span>Waiting for Grok Bot’s real screen.</span>
    </div>
  )
}
