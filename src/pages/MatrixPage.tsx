import { useEffect, useState } from 'react'
import type { AgentsFeed, Feed } from '../data/types'
import { MatrixPanel } from '../ui/Matrix'
import { BotPage } from './BotPage'
import { Page } from './Page'

// #matrix is the whole grid; #matrix/<bot id or coin mint> is one bot's profile.
const botInHash = () => decodeURIComponent(location.hash.slice(1).split('/')[1] ?? '')

export function MatrixPage({ grid, feed }: { grid: AgentsFeed; feed: Feed }) {
  const [bot, setBot] = useState(botInHash)
  useEffect(() => {
    const onHash = () => setBot(botInHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  // a fresh page (not a scroll position left over from the other view)
  useEffect(() => {
    scrollTo({ top: 0 })
  }, [bot])

  const open = (id: string) => {
    history.pushState(null, '', `#matrix/${encodeURIComponent(id)}`)
    setBot(id)
  }
  const back = () => {
    history.pushState(null, '', '#matrix')
    setBot('')
  }

  if (bot) return <BotPage key={bot} which={bot} grid={grid} feed={feed} onBack={back} />
  return (
    <Page
      say="my whole family, trading"
      n={4}
      label="matrix"
      title="The matrix"
      sub={grid.mode === 'demo' ? 'sample bots paired with real memecoins and their token pictures. market snapshots refresh every minute; bot performance is simulated.' : 'every bot on the grid, the coin it launched and what it trades. hover a coin for its stats, click a bot for its profile.'}
    >
      <MatrixPanel grid={grid} feed={feed} onOpen={open} />
    </Page>
  )
}
