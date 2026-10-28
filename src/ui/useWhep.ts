import { useEffect, useRef, useState } from 'react'

// Plays a WebRTC live stream from a WHEP URL (Cloudflare Stream gives one per live
// input). Under half a second behind the real screen. Retries every 8s while the
// stream is offline, and reports whether video is actually playing.
export function useWhep(url: string, on: boolean) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!url || !on) return
    let pc: RTCPeerConnection | null = null
    let retry = 0
    let dead = false

    const stop = () => {
      pc?.close()
      pc = null
      setPlaying(false)
    }
    const again = () => {
      stop()
      if (!dead) retry = window.setTimeout(start, 8000)
    }
    const start = async () => {
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' })
        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.ontrack = (e) => {
          const v = video.current
          if (!v) return
          v.srcObject = e.streams[0] ?? new MediaStream([e.track])
          v.play().catch(() => {})
        }
        pc.onconnectionstatechange = () => {
          if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) again()
        }
        await pc.setLocalDescription(await pc.createOffer())
        await gathered(pc)
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp })
        if (!res.ok) return again() // not live right now
        await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })
      } catch {
        again()
      }
    }
    start()
    return () => {
      dead = true
      clearTimeout(retry)
      stop()
    }
  }, [url, on])

  useEffect(() => {
    const v = video.current
    if (!v) return
    const yes = () => setPlaying(true)
    const no = () => setPlaying(false)
    v.addEventListener('playing', yes)
    v.addEventListener('emptied', no)
    v.addEventListener('ended', no)
    return () => {
      v.removeEventListener('playing', yes)
      v.removeEventListener('emptied', no)
      v.removeEventListener('ended', no)
    }
  }, [])

  return { video, playing }
}

// Wait for ICE candidates (or 1.5s), since the offer goes out in one request.
function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((done) => {
    if (pc.iceGatheringState === 'complete') return done()
    const t = setTimeout(done, 1500)
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t)
        done()
      }
    })
  })
}
