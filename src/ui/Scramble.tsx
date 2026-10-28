import { useEffect, useRef, useState } from 'react'

const GLYPHS = '01#$%&*+=<>/\\|ABCDEFXZ$@!?'

// Text that spins through random glyphs like a slot reel, then locks in letter by
// letter. Runs when it appears and again on hover.
export function Scramble({ text, ms = 700 }: { text: string; ms?: number }) {
  const [shown, setShown] = useState(text)
  const raf = useRef(0)

  const run = () => {
    cancelAnimationFrame(raf.current)
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = (now - t0) / ms
      let out = ''
      for (let i = 0; i < text.length; i++) {
        // each letter settles a little after the one before it
        const lock = (i + 1) / text.length
        out += k >= lock || text[i] === ' ' ? text[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      setShown(out)
      if (k < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    run()
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <span className="scramble" aria-label={text} onMouseEnter={run}>
      <span aria-hidden>{shown}</span>
    </span>
  )
}
