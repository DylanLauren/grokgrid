import type { CSSProperties } from 'react'
import './roll.css'

// Text that rolls up letter by letter when its button or link is hovered,
// the way the labels on x.ai move. Screen readers get the plain text.
export function Roll({ children }: { children: string }) {
  return (
    <span className="roll" aria-label={children}>
      {[...children].map((c, i) => (
        <span key={i} className="roll-c" aria-hidden style={{ '--i': i } as CSSProperties}>
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  )
}
