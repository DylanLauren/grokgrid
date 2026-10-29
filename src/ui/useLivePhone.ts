import { useEffect, useRef, useState } from 'react'
import { startVisibleLivePhone, type LivePhoneState } from './livePhoneSession'

export function useLivePhone(watching: boolean) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<LivePhoneState>('idle')
  useEffect(() => {
    if (!watching || !video.current) { setState('idle'); return }
    return startVisibleLivePhone(video.current, setState)
  }, [watching])
  const current = watching ? state : 'idle'
  return { video, state: current, playing: current === 'playing' }
}
