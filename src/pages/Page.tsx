import { useRef, type CSSProperties, type ReactNode } from 'react'
import { LiveBot, useEyesFollow } from '../ui/LiveBot'
import { Scramble } from '../ui/Scramble'
import './pages.css'

// The frame every page shares: an index and label, a big title whose letters lift
// under the pointer, one line under it, and the content.
export function Page({ n, label, title, sub, side, say, children }: { n: number; label: string; title: string; sub: ReactNode; side?: ReactNode; say: string; children: ReactNode }) {
  const root = useRef<HTMLElement>(null)
  useEyesFollow(root)
  return (
    <main
      ref={root}
      className="page"
      onPointerMove={(e) => {
        // cards light their edge where the pointer is
        const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
        if (!card) return
        const r = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${e.clientX - r.left}px`)
        card.style.setProperty('--my', `${e.clientY - r.top}px`)
      }}
    >
      <div className="pg">
        <header className="pg-head">
          <div className="pg-eyebrow mono">
            <span>[{String(n).padStart(2, '0')}]</span>
            <Scramble text={label} />
            {side}
          </div>
          <h1 className="pg-title" aria-label={title}>
            {[...title].map((c, i) => (
              <span key={i} aria-hidden style={{ '--i': i } as CSSProperties}>
                {c === ' ' ? ' ' : c}
              </span>
            ))}
          </h1>
          <p className="pg-sub">{sub}</p>
          {/* he keeps you company on every page */}
          <div className="pg-host">
            <LiveBot color="house" eye="#0a0a0a" shape="sphere" habit="look" size={200} say={say} shout />
          </div>
        </header>
        {children}
      </div>
    </main>
  )
}

export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="pg-sec">
      <div className="pg-sec-head">
        <h2>{title}</h2>
        {note && <span className="mono">{note}</span>}
      </div>
      {children}
    </section>
  )
}
