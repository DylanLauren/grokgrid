import { useEffect, useRef, useState } from 'react'
import type { View } from '../scene/Scene'
import { MAIN_TICKER } from '../config'
import './tour.css'

type Tab = 'desk' | 'calls' | 'stats' | 'matrix' | 'grid' | 'docs'

// Five stops, each one moves the room or opens the panel it talks about.
const STEPS: { title: string; body: string; tab: Tab; view: View }[] = [
  { title: 'meet him', body: 'a Grok Bot with his own wallet and the pump.fun app. drag to look around his desk.', tab: 'desk', view: 'third' },
  { title: 'his phone', body: 'press 2 any time to look over his shoulder. this is the screen he trades on.', tab: 'desk', view: 'phone' },
  { title: 'every trade, called', body: 'each buy and sell shows up here the moment he makes it, linked to the transaction.', tab: 'calls', view: 'third' },
  { title: 'the matrix', body: 'every bot on the grid with its coin attached: market cap, volume, wallet, p&l. live.', tab: 'matrix', view: 'third' },
  { title: 'launch your own', body: `one agent per wallet. your wallet receives 80% of creator fees; 20% goes to the $${MAIN_TICKER} burn wallet. public launches are currently paused.`, tab: 'grid', view: 'third' },
]

const KEY = 'gg-toured'

export function seenTour() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

export function Tour({ go, onDone }: { go: (tab: Tab, view: View) => void; onDone: () => void }) {
  const [i, setI] = useState(0)
  const s = STEPS[i]
  // skip and done go back to his desk; clicking off just closes it where you are
  const finish = (home = true) => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private mode: the tour simply shows again next visit */
    }
    if (home) go('desk', 'third')
    onDone()
  }
  // clicking anywhere off the card (not dragging the room) ends the tour
  const end = useRef(finish)
  useEffect(() => {
    end.current = finish
  })
  useEffect(() => {
    let down = { x: 0, y: 0 }
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return
      if (!(e.target as Element).closest('.tour')) end.current(false)
    }
    addEventListener('pointerdown', onDown)
    addEventListener('pointerup', onUp)
    return () => {
      removeEventListener('pointerdown', onDown)
      removeEventListener('pointerup', onUp)
    }
  }, [])
  const next = () => {
    if (i === STEPS.length - 1) return finish()
    const n = STEPS[i + 1]
    go(n.tab, n.view)
    setI(i + 1)
  }
  return (
    <div className="tour" role="dialog" aria-label="tour">
      <div className="tour-top mono">
        <span>
          {String(i + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </span>
        <button onClick={() => finish()}>skip</button>
      </div>
      <b>{s.title}</b>
      <p>{s.body}</p>
      <div className="tour-dots">
        {STEPS.map((_, k) => (
          <i key={k} className={k <= i ? 'on' : ''} />
        ))}
        <button className="tour-next" onClick={next}>
          {i === STEPS.length - 1 ? 'done' : 'next'}
        </button>
      </div>
    </div>
  )
}
