import { useEffect, useState } from 'react'
import type { AgentsFeed, Feed } from '../data/types'
import { ago } from '../lib/format'
import { MatrixPanel } from '../ui/Matrix'
import { Page } from './Page'

export function MatrixPage({ grid, feed }: { grid: AgentsFeed; feed: Feed }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <Page
      say="my whole family, trading"
      n={4}
      label="matrix"
      title="The matrix"
      sub="every bot on the grid and the coin it trades for. read from the chain and refreshed every 10 seconds."
      side={grid.mode === 'live' && <span className="live-pill"><i />live · {ago(grid.updatedAt, now)}</span>}
    >
      <MatrixPanel grid={grid} feed={feed} />
    </Page>
  )
}
