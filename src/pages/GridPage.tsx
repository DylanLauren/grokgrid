import { useEffect, useState } from 'react'
import { MAIN_TICKER } from '../config'
import type { AgentsFeed } from '../data/types'
import { FAMILY } from '../ui/BotMark'
import { LiveBot, type Habit } from '../ui/LiveBot'
import { Roll } from '../ui/Roll'
import { Page, Section } from './Page'

// What each one of the family does while it waits, and what it says when you point at it.
const CAST: { habit: Habit; say: string }[] = [
  { habit: 'look', say: 'i watch the whales' },
  { habit: 'bounce', say: 'pick me pick me' },
  { habit: 'float', say: 'i only buy dips' },
  { habit: 'sway', say: 'steady hands' },
  { habit: 'tilt', say: 'hmm, that chart' },
  { habit: 'flip', say: 'full send' },
  { habit: 'hop', say: 'up only' },
  { habit: 'squish', say: 'i hold forever' },
  { habit: 'doze', say: 'wake me at 2x' },
]

const DRAFT_KEY = 'gg-bot-draft'

export function GridPage({ grid }: { grid: AgentsFeed }) {
  const [draft, setDraft] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '') as { look: number; name: string; persona: string }
    } catch {
      return { look: 3, name: '', persona: '' }
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      /* private mode */
    }
  }, [draft])
  const [cheer, setCheer] = useState(0)

  const ready = false // the launch flow opens after the main coin is live
  const look = FAMILY[draft.look]
  const userBots = grid.mode === 'live' ? grid.agents.filter((a) => !a.house).length : 0

  return (
    <Page say="make me a sibling" n={5} label="the grid" title="Launch a bot" sub={`every bot is its own coin. 80% of its fees fund its trades, 20% buy and burn $${MAIN_TICKER}. pick one of the family to start.`}>
      <div className="gd-line" role="radiogroup" aria-label="pick a bot">
        {FAMILY.map((f, i) => (
          <button
            key={f.name}
            role="radio"
            aria-checked={i === draft.look}
            className={`gd-pick ${i === draft.look ? 'on' : ''}`}
            onClick={() => {
              setDraft({ ...draft, look: i })
              setCheer((n) => n + 1)
            }}
          >
            <LiveBot color={f.color} shape={f.shape} habit={CAST[i].habit} say={CAST[i].say} size={120} delay={i * -0.37} />
            <span className="gd-name">{f.name}</span>
          </button>
        ))}
      </div>

      <div className="gd-build">
        <div className="card gd-preview">
          <LiveBot key={`${draft.look}-${cheer}`} color={look.color} shape={look.shape} habit={CAST[draft.look].habit} size={180} selected />
          <b>{draft.name || 'your bot'}</b>
          <span>{draft.persona || 'one line on how it trades'}</span>
        </div>
        <div className="card gd-form">
          <label>
            name
            <input maxLength={32} value={draft.name} placeholder="night shift" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            how it trades
            <input maxLength={120} value={draft.persona} placeholder="only buys coins under 30K, sells at 2x" onChange={(e) => setDraft({ ...draft, persona: e.target.value })} />
          </label>
          <div className="gd-split">
            <div>
              <b>80%</b>
              <span>of its creator fees go to its own trading wallet</span>
            </div>
            <div>
              <b>20%</b>
              <span>buy ${MAIN_TICKER} on the market and burn it</span>
            </div>
          </div>
          <button className="btn" disabled={!ready}>
            <Roll>Launch bot</Roll>
          </button>
          <p className="gd-note">{ready ? 'one wallet approval. the coin and the fee split go live together.' : `launching opens once $${MAIN_TICKER} is live. your draft is saved in this tab.`}</p>
        </div>
      </div>

      <Section title="On the grid" note={`${userBots} launched`}>
        <div className="card gd-empty">
          <LiveBot color="#0b0b0b" shape="sphere" habit="doze" size={44} />
          <span>no user bots yet. the first ones line up in the matrix, ranked by profit.</span>
        </div>
      </Section>
    </Page>
  )
}
