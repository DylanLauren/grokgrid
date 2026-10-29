import { useEffect, useRef, useState, type ReactNode } from 'react'

// A section that eases in the first time it scrolls into view: the title's words rise one by
// one, then the paragraphs and panels below follow in a short stagger (styles in pages.css).
export function Reveal({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(true)
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setShown(true)
        io.disconnect()
      }
    }, { rootMargin: '0px 0px -12% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <section ref={ref} id={id} className={`dc-sec ${shown ? 'in' : ''}`}>
      {children}
    </section>
  )
}
