import { useEffect, useRef, useState } from 'react'

// Plays a WebRTC live stream from a WHEP URL (Cloudflare Stream gives one per live
// input). Actual latency depends on the broadcaster and network. Retries every 8s while the
// stream is offline, and reports whether video is actually playing.
export function useWhep(url: string, on: boolean) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!url || !on) return
    let pc: RTCPeerConnection | null = null
    let retry = 0
    let dead = false
    let request: AbortController | null = null

    const stop = () => {
      request?.abort()
      request = null
      pc?.close()
      if (video.current) video.current.srcObject = null
      pc = null
      setPlaying(false)
    }
    const again = () => {
      clearTimeout(retry)
      stop()
      if (!dead) retry = window.setTimeout(start, 8000)
    }
    const start = async () => {
      if (dead) return
      const controller = new AbortController()
      request = controller
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' })
        const connection = pc
        const stream = new MediaStream()
        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.ontrack = (e) => {
          const v = video.current
          if (!v) return
          if (dead || pc !== connection) return
          stream.addTrack(e.track)
          v.srcObject = stream
          v.play().catch(() => {})
        }
        pc.onconnectionstatechange = () => {
          if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) again()
        }
        await pc.setLocalDescription(await pc.createOffer())
        await gathered(connection)
        if (dead || pc !== connection) return
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: connection.localDescription!.sdp, signal: controller.signal })
        if (dead || pc !== connection) return
        if (!res.ok) return again() // not live right now
        const sdp = await res.text()
        if (dead || pc !== connection) return
        await connection.setRemoteDescription({ type: 'answer', sdp })
      } catch {
        if (!dead && !controller.signal.aborted) again()
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
    v.addEventListener('waiting', no)
    v.addEventListener('stalled', no)
    return () => {
      v.removeEventListener('playing', yes)
      v.removeEventListener('emptied', no)
      v.removeEventListener('ended', no)
      v.removeEventListener('waiting', no)
      v.removeEventListener('stalled', no)
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
