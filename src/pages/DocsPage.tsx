import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { MAIN_TICKER } from '../config'
import { Addresses, CostTable, FlowDiagram } from '../ui/Panels'
import { Roll } from '../ui/Roll'
import { Page } from './Page'

// body elements carry a key only because they sit in this array
const SECTIONS: [string, string, ReactNode][] = [
  ['what', 'What he is', <p key="b">GrokGrid is a window into Grok Bot’s work on pump.fun. The phone can show his actual working browser while he observes the market. Wallet monitoring is active; automatic trading is currently disabled. A live screen means the capture is current, not that a trade is happening.</p>],
  [
    'how',
    'Current status',
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
      <p>The intended ${MAIN_TICKER} fee allocation is 80% to the treasury and 20% to the burn wallet. The official mint must be configured and verified before its buy-and-burn route can be activated. Automatic buying and burning are not active yet.</p>
      <p>The prepared grid-bot launch flow sets 80% of creator fees to the connected launcher wallet, which is also that bot’s trading wallet, and 20% to the burn wallet. It checks the on-chain recipients and locked fee split before registering the bot. Fee allocation alone does not start a trading worker or execute a burn.</p>
    </Fragment>,
  ],
  [
    'launch',
    'Launching a bot',
    <Fragment key="b">
      <p>Public launches are paused until agent execution and recovery are ready. The prepared flow lets you choose a look, name, strategy and limits, then review a coin-launch transaction in your wallet. It includes the 80/20 creator-fee allocation and can include an optional first buy.</p>
      <p>Each wallet can launch one agent; there is no fixed platform-wide agent limit. Your connected wallet is the launcher, developer wallet and trading wallet for that agent. Confirmed coin creation, authorized execution, recovery and enforced trading limits must all be verified before launches reopen. Showing a coin in the matrix does not by itself prove that its bot is trading. Trading-wallet keys stay outside the website.</p>
    </Fragment>,
  ],
  ['example', 'A worked example', <p key="b">For an illustration of the planned allocation, 1 SOL of creator fees would assign 0.8 SOL to the trading wallet and 0.2 SOL to the burn wallet. That allocation is separate from trading volume. A buy or burn occurs only after its worker is implemented, configured and activated; this example is not a completed transaction.</p>],
  ['cost', 'What it costs', <CostTable key="b" />],
  ['trust', 'Wallet control', <p key="b">You review and approve any launch transaction in your own wallet. Your connected wallet keeps its own keys. Connecting it or approving a coin launch does not authorize unattended trading. Any future automatic trading needs a separate, explicit authorization path with enforced limits. The house worker currently cannot sign or spend. Public addresses below let you inspect on-chain balances; they do not prove that execution is enabled.</p>],
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
    <Page say="no secrets in here" n={6} label="docs" title="How it works" sub="current capabilities, planned fee allocation, launch readiness and wallet control.">
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
