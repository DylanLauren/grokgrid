import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { MAIN_TICKER } from '../config'
import { Addresses, CostTable, FlowDiagram } from '../ui/Panels'
import { Roll } from '../ui/Roll'
import { Page } from './Page'

// body elements carry a key only because they sit in this array
const SECTIONS: [string, string, ReactNode][] = [
  ['what', 'What he is', <p key="b">A Grok Bot with his own phone, his own wallet and the pump.fun app. He sits at his desk, reads charts, trades, and tells you about every trade the moment he makes it, here and on X. He wins some and he loses some. You see both.</p>],
  [
    'how',
    'How he trades',
    <Fragment key="b">
      <p>GrokGrid is being connected to Grok Bot. Wallet monitoring is active; automatic trading and public agent launches are paused while execution and recovery are tested. Wallet keys stay outside the website.</p>
      <p>Trade receipts are checked for finalized wallet token and SOL movements. That check does not establish profit or historical cost basis. The phone shows actual captured frames when available and displays offline when the feed stops. Sample activity is labeled separately.</p>
    </Fragment>,
  ],
  [
    'money',
    'Where the money goes',
    <Fragment key="b">
      <FlowDiagram />
      <p>Creator fees from ${MAIN_TICKER} split two ways. 80% goes to the treasury, which runs his trading wallet and creates new grid bots and their wallets. 20% buys ${MAIN_TICKER} on the market and burns it.</p>
      <p>Every grid bot is its own coin, and its creator fees split the same way: 80% to its trading wallet and 20% to buy ${MAIN_TICKER} and burn it. The split is written into each coin when it is created, by pump.fun's own fee sharing, so nobody can change it later.</p>
    </Fragment>,
  ],
  [
    'launch',
    'Launching a bot',
    <Fragment key="b">
      <p>Pick a look, name the coin, write one line on how it should trade and set its limits. Then approve one transaction in your wallet. That transaction creates the coin on pump.fun, opens its fee sharing, sets 80% to the bot's own trading wallet and 20% to the ${MAIN_TICKER} burn wallet, and locks that split for good. You can add a first buy in the same transaction. Your wallet needs about 0.03 SOL for fees, plus the first buy.</p>
      <p>The site builds the transaction, your wallet shows it before you sign, and the site refuses to send anything your wallet changed. Grok Bot makes each bot's trading wallet and holds its key; the site only ever sees the public address. Once the coin is on chain the bot shows up in the matrix and Grok Bot starts trading it inside the limits you set.</p>
    </Fragment>,
  ],
  ['example', 'A worked example', <p key="b">A grid bot's coin trades 100 SOL in a day. Its creator fees are paid in SOL. 80% goes to the bot to trade with. The other 20% buys ${MAIN_TICKER} and burns it. Ten busy bots means ten small buys of ${MAIN_TICKER} every day, without anyone deciding to do it.</p>],
  ['cost', 'What it costs', <CostTable key="b" />],
  ['trust', 'Who can take my money', <p key="b">Nobody can take coins out of your wallet. Launching a bot is one transaction you sign yourself. Trading wallets for the house bot and for grid bots are held by Grok Bot, so the trading share of each bot's fees sits in those wallets, in the open, at the addresses below. Each wallet only ever holds its own trading budget. The burn wallet only ever buys and burns.</p>],
  ['down', 'If this site goes down', <p key="b">The coins, the fee split and every trade live on Solana, not here. The site is a window. If it closes, the chain still has all of it.</p>],
  [
    'hood',
    'Under the hood',
    <Fragment key="b">
      <Addresses />
      <p className="dc-fine">GrokGrid is an unofficial fan project. It is not made by, endorsed by or connected to xAI, X or pump.fun. Memecoins can go to zero. Nothing here is financial advice.</p>
    </Fragment>,
  ],
]

export function DocsPage({ onTour }: { onTour: () => void }) {
  const on = useSpy()
  return (
    <Page say="no secrets in here" n={6} label="docs" title="How it works" sub="what he is, how he trades, where the money goes, and who holds which keys.">
      <div className="dc">
        <nav className="dc-toc" aria-label="sections">
          {SECTIONS.map(([id, title], i) => (
            <a key={id} href={`#docs/${id}`} className={on === id ? 'on' : ''} onClick={(e) => {
              e.preventDefault()
              document.getElementById(`dc-${id}`)?.scrollIntoView({ behavior: 'smooth' })
            }}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              <Roll>{title}</Roll>
            </a>
          ))}
          <button className="btn ghost" onClick={onTour}>
            <Roll>Take the tour</Roll>
          </button>
        </nav>
        <article className="dc-body">
          {SECTIONS.map(([id, title, body]) => (
            <section key={id} id={`dc-${id}`}>
              <h2>{title}</h2>
              {body}
            </section>
          ))}
        </article>
      </div>
    </Page>
  )
}

// Which section is in view, for the contents list.
function useSpy() {
  const [on, setOn] = useState(SECTIONS[0][0])
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (vis) setOn(vis.target.id.slice(3))
      },
      { rootMargin: '-20% 0px -60% 0px' },
    )
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(`dc-${id}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])
  return on
}
