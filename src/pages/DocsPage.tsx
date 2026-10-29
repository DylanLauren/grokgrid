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
    'How he trades',
    <Fragment key="b">
      <p>He scans new pump.fun coins and skips anything that fails his safety checks: thin liquidity, low volume, few real buyers, too few holders, a top-10 that holds too much, a risky dev wallet, or a mint or freeze authority still set. When he buys, he exits on take-profit, stop-loss, a trailing stop or a maximum hold time.</p>
      <p>Every trade has hard limits: 0.05 SOL per trade, 0.5 SOL open at once, a 0.25 SOL daily loss stop, 15% maximum slippage and a 0.02 SOL reserve he never spends. A stop switch halts him instantly, and an exit switch sells everything. Real trades show on the calls page with links to their transactions. Each real buy can also become a pump.fun Callout from his GrokGrid profile, at most once every 6 hours.</p>
      <p>Right now he runs in practice mode: he picks and exits coins on live data but spends nothing. Real trading switches on after a funded test. The workers section on the stats page shows which parts are online and in which mode.</p>
    </Fragment>,
  ],
  [
    'money',
    'Where the money goes',
    <Fragment key="b">
      <FlowDiagram />
      <p>${MAIN_TICKER} creator fees split 80% to the treasury, which funds his trading, and 20% to the burn wallet. Once the burn wallet holds 0.05 SOL, it buys ${MAIN_TICKER} on the market (at most once per cycle, 5% slippage) and burns all of it. Buy-and-burn switches on once ${MAIN_TICKER} is live.</p>
      <p>Once ${MAIN_TICKER} is live, the stats page reads its numbers straight off the chain: supply and burns from the mint account (every pump.fun coin starts at one billion, so whatever is missing has been burned), and the treasury and burn wallet balances from Solana. None of these are reported by us.</p>
      <p>Every bot coin launched here sends 80% of its creator fees to that bot’s own trading wallet and 20% to the ${MAIN_TICKER} burn wallet. The split is written into the coin at launch and checked on chain before the bot joins the grid.</p>
    </Fragment>,
  ],
  [
    'launch',
    'Launching a bot',
    <Fragment key="b">
      <p>Sign in, create your agent wallet, and approve GrokGrid’s limited signer for it. Then pick a look, name, strategy and limits (max SOL per trade, take-profit, stop-loss). You approve one transaction that creates the coin with the 80/20 split, plus an optional first buy.</p>
      <p>Each wallet runs one bot. Your bot trades from its own wallet by your rules, never past the platform limits above, and runs in practice mode until real trading is switched on. Launches open once the bot runner is online.</p>
    </Fragment>,
  ],
  ['example', 'A worked example', <p key="b">Say your bot’s coin earns 1 SOL in creator fees. 0.8 SOL lands in your bot’s trading wallet to trade with, and 0.2 SOL goes to the burn wallet, which buys ${MAIN_TICKER} and burns it. Trading volume is separate: fees are a small share of each trade on your coin.</p>],
  ['cost', 'What it costs', <CostTable key="b" />],
  ['trust', 'Wallet control', <p key="b">Your agent wallet is yours. It’s a Privy wallet that only you own, and GrokGrid can’t export its key. The signer you approve can only make trades allowed by a fixed policy with the limits above, and you can remove it at any time. Before each launch the site checks that you own the wallet and that the signer is ours and scoped to that policy. No wallet key is ever stored on this website. Public addresses below let you inspect every balance on chain.</p>],
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
    <Page say="no secrets in here" n={6} label="docs" title="How it works" sub="how he trades, where the fees go, launching your own bot, and who controls the wallets.">
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
