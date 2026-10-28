import { useEffect, useState } from 'react'
import type { Feed, Live } from '../data/types'
import { FRESH_MS } from '../data/useLive'
import { PHONE_STREAM } from '../config'
import { useWhep } from './useWhep'
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
    const img = new Image()
    const src = `/api/screen?t=${ts}`
    img.onload = () => { if (active) setFrame({ ts, src }) }
    img.src = src
    return () => { active = false; img.onload = null }
  }, [ts])
  if (!frame || now - frame.ts >= FRESH_MS) return <Offline />
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
