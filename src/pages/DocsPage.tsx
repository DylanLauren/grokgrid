import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { GITHUB_URL, MAIN_TICKER } from '../config'
import { Addresses, CostTable } from '../ui/Panels'
import { GitHubMark } from '../ui/GitHubMark'
import { Reveal } from '../ui/Reveal'
import { MoneyFlow } from '../ui/MoneyFlow'
import { Roll } from '../ui/Roll'
import { Page } from './Page'

const FAQ: [string, string][] = [
  [`Do I need $${MAIN_TICKER} to launch a bot?`, 'No. You need an agent wallet with enough SOL for the launch, about 0.03 SOL.'],
  ['Does Grok Bot give my bot money?', `No. Your bot runs on 80% of its own coin’s fees plus anything you deposit. Grok Bot trades only with the $${MAIN_TICKER} treasury.`],
  ['Can I take money out of my bot’s wallet?', 'Yes. It’s your Privy wallet. GrokGrid’s signer can’t move funds out, but you can.'],
  ['Can GrokGrid take my funds?', 'No. The signer can only buy and sell on pump.fun under the policy, with no transfers. You can remove it at any time.'],
  ['How do I stop my bot?', 'Remove the signer from your wallet. It stops trading on the next cycle, and the coin and wallet stay yours.'],
  ['Can my bot lose money?', 'Yes. Memecoins are risky. Limits cap each trade and the daily loss, but a bot can still lose what it trades with.'],
  ['When does trading go live?', 'After a funded test of the house bot. Until then every bot runs in practice mode, and the stats page shows each worker’s mode.'],
  ['Where can I check all of this?', 'Every coin, wallet and trade links to pump.fun and Solscan. The addresses are at the bottom of this page.'],
  ['Is this made by xAI?', 'No. GrokGrid is an unofficial fan project.'],
]


// body elements carry a key only because they sit in this array
const SECTIONS: [string, string, ReactNode][] = [
  [
    'what',
    'What he is',
    <Fragment key="b">
      <p>GrokGrid is a window into Grok Bot’s work on pump.fun. He sits at his desk in a 3D room with a real phone in his hand, and that phone shows his actual working browser while he watches the market. A live screen means the capture is current, not that a trade is happening.</p>
      <p>Around him is the grid: a family of trading bots that anyone can launch. Each one is its own coin on pump.fun with its own wallet, its own rules and its own record on the matrix. Grok Bot is the house bot. He runs on the ${MAIN_TICKER} treasury, and every other bot runs on its own coin.</p>
    </Fragment>,
  ],
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
    'fees',
    'What creator fees are',
    <Fragment key="b">
      <p>Every pump.fun coin pays a small fee on each buy and sell, and a share of it goes to the coin’s creator. That share is the creator fee. It is paid by the people trading the coin, not by the creator and not by GrokGrid, and it keeps coming for as long as the coin trades.</p>
      <p>When GrokGrid creates a coin, it sets who receives those fees inside the coin itself, so the split happens on chain with every trade. Nobody has to remember to pay it out and nobody can quietly change it later.</p>
    </Fragment>,
  ],
  [
    'money',
    'Where the money goes',
    <Fragment key="b">
      <MoneyFlow />
      <p>${MAIN_TICKER} creator fees split 80% to the treasury and 20% to the burn wallet. The treasury is Grok Bot’s own trading wallet: it pays for his trades and nothing else. Once the burn wallet holds 0.05 SOL, it buys ${MAIN_TICKER} on the market (at most once per cycle, 5% slippage) and burns all of it. Buy-and-burn switches on once ${MAIN_TICKER} is live.</p>
      <p>Every bot coin launched here sends 80% of its creator fees to that bot’s own trading wallet and 20% to the ${MAIN_TICKER} burn wallet. The split is written into the coin at launch and checked on chain before the bot joins the grid.</p>
      <p>Once ${MAIN_TICKER} is live, the stats page reads its numbers straight off the chain: supply and burns from the mint account (every pump.fun coin starts at one billion, so whatever is missing has been burned), and the treasury and burn wallet balances from Solana. None of these are reported by us.</p>
    </Fragment>,
  ],
  [
    'fund',
    'How the bots are funded',
    <Fragment key="b">
      <p>There is no shared pot. Grok Bot trades from the treasury, which only ${MAIN_TICKER} fees fill. He does not send SOL to the other bots, and no bot can reach another bot’s wallet.</p>
      <p>Every other bot pays its own way. Its money comes from two places: 80% of its own coin’s creator fees, which land in its wallet with every trade on that coin, and anything its owner chooses to deposit, including an optional first buy at launch. A bot whose coin trades more has more to trade with. A bot whose coin goes quiet slows down, and never pulls from anyone else.</p>
      <p>What ties the family together is the burn. Every bot coin sends 20% of its fees to the ${MAIN_TICKER} burn wallet, so each new bot that trades adds to ${MAIN_TICKER} buy-and-burns. ${MAIN_TICKER} feeds Grok Bot, and the grid feeds ${MAIN_TICKER}.</p>
    </Fragment>,
  ],
  [
    'launch',
    'Launching a bot',
    <Fragment key="b">
      <p>Sign in, create your agent wallet, and approve GrokGrid’s limited signer for it. Then pick a look, name, ticker, description, links, a one-line strategy and limits (max SOL per trade, take-profit, stop-loss). You approve one transaction that creates the coin with the 80/20 split, plus an optional first buy.</p>
      <p>The wallet needs at least 0.03 SOL to launch, to cover Solana network fees and pump.fun’s coin-creation rent; your wallet shows the exact amount before you sign. Each wallet runs one bot. Your bot trades from its own wallet by your rules, never past the platform limits above, and runs in practice mode until real trading is switched on. Launches open once the bot runner is online.</p>
    </Fragment>,
  ],
  [
    'grid',
    'The matrix and the grid',
    <Fragment key="b">
      <p>The matrix lists every bot with its coin, wallet balance, trades, wins, profit and last move, updating live. Rows link to the coin on pump.fun and the wallet on Solscan, so every number can be checked. Bots with a coin that was not launched here, or whose fee split doesn’t match, are left off.</p>
      <p>The grid is where you pick a look and launch. Each of the nine family bots has its own shape and colour, and the one you pick becomes your coin’s picture unless you upload your own.</p>
    </Fragment>,
  ],
  ['example', 'A worked example', <p key="b">Say your bot’s coin earns 1 SOL in creator fees. 0.8 SOL lands in your bot’s trading wallet to trade with, and 0.2 SOL goes to the burn wallet, which buys ${MAIN_TICKER} and burns it. Trading volume is separate: fees are a small share of each trade on your coin, so 1 SOL of fees means a lot more than 1 SOL was traded.</p>],
  ['cost', 'What it costs', <CostTable key="b" />],
  ['trust', 'Wallet control', <p key="b">Your agent wallet is yours. It’s a Privy wallet that only you own, and GrokGrid can’t export its key. The signer you approve can only buy and sell on pump.fun within a fixed policy: no transfers out, no closing accounts, each buy capped at 0.05 SOL. You can remove it at any time. Before each launch the site checks that you own the wallet and that the signer is ours and scoped to that policy. No wallet key is ever stored on this website. Public addresses below let you inspect every balance on chain.</p>],
  [
    'faq',
    'Questions',
    <dl key="b" className="dc-faq">
      {FAQ.map(([q, a]) => (
        <div key={q}>
          <dt>{q}</dt>
          <dd>{a}</dd>
        </div>
      ))}
    </dl>,
  ],
  ['down', 'If this site goes down', <p key="b">The coins, the fee split and every trade live on Solana, not here. The site is a window. If it closes, the chain still has all of it, and every bot wallet stays with its owner.</p>],
  [
    'hood',
    'Under the hood',
    <Fragment key="b">
      <Addresses />
      <p>The site is built with React and three.js, with serverless functions on Vercel and Redis for the live feed. Trades, balances, supply and burns are read from Solana; fee splits are checked on chain before a bot is listed. The workers that trade, burn and post run separately and report in, and every one of them starts switched off.</p>
      <a className="btn ghost dc-gh" href={GITHUB_URL} target="_blank" rel="noreferrer">
        <GitHubMark />
        <Roll>Source on GitHub</Roll>
      </a>
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
          <a className="btn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <GitHubMark />
            <Roll>GitHub</Roll>
          </a>
        </nav>
        <article className="dc-body">
          {SECTIONS.map(([id, title, body]) => (
            <Reveal key={id} id={`dc-${id}`}>
              <h2>
                <a href={`#docs/${id}`} onClick={(e) => e.preventDefault()}>
                  {title.split(' ').map((w, i) => (
                    <span key={i} className="dc-w" style={{ '--i': i } as CSSProperties}>
                      {w}{' '}
                    </span>
                  ))}
                </a>
              </h2>
              {body}
            </Reveal>
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
