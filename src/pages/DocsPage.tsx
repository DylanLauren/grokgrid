import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { GITHUB_URL, MAIN_TICKER, X_HANDLE } from '../config'
import { XMark } from '../ui/XMark'
import { Addresses, CostTable } from '../ui/Panels'
import { GitHubMark } from '../ui/GitHubMark'
import { Reveal } from '../ui/Reveal'
import { MoneyFlow } from '../ui/MoneyFlow'
import { Roll } from '../ui/Roll'
import { Page } from './Page'

const FAQ: [string, string][] = [
  [`Do I need $${MAIN_TICKER} to launch a bot?`, 'No. Connect Phantom with enough SOL for the launch (about 0.03 SOL), your bot’s funding (at least 0.03 SOL) and any dev buy.'],
  ['Does Grok Bot give my bot money?', `No. Your bot runs on 80% of its own coin’s fees plus anything you deposit. Grok Bot trades only with the $${MAIN_TICKER} treasury.`],
  ['Can I take money out of my bot’s wallet?', 'Yes. It’s your Privy wallet. GrokGrid’s signer can’t move funds out, but you can.'],
  ['Can GrokGrid take my funds?', 'No. The signer can only buy and sell on pump.fun under the policy, with no transfers. You can remove it at any time.'],
  ['How do I stop my bot?', 'Remove the signer from your wallet. It stops trading on the next cycle, and the coin and wallet stay yours.'],
  ['Can my bot lose money?', 'Yes. Memecoins are risky. Limits cap each trade and the daily loss, and Grok Bot’s size only grows as fees come in, but a bot can still lose what it trades with.'],
  ['Who gets my coin’s fees?', 'Your bot’s trading wallet gets 80% of its coin’s creator fees and trades with them; 20% goes to the $'+MAIN_TICKER+' burn wallet. Your Phantom gets none: it only signs the launch and holds your dev buy.'],
  ['What is the dev buy?', 'An optional buy of your own coin by your Phantom, made in the same approval that creates it. Those tokens stay in your Phantom; the bot never trades or sells them.'],
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
      <p>His budget grows with what comes in. Each trade is 10% of the last 24 hours’ creator fees or 2% of his spare balance, whichever is bigger, up to a cap set by those fees: 0.02 SOL per trade under 1 SOL of daily fees, 0.05 SOL from 1 SOL, 0.1 SOL from 5 SOL and 0.5 SOL from 10 SOL, the hard maximum. Open positions stay under three times the cap and a quarter of his spare balance. The daily loss stop is two and a half times the cap, and never more than a fifth of his wallet. When fees slow down, his size shrinks again. On top of that, slippage is capped at 15%, he holds at most 3 coins, and a 0.02 SOL reserve is never spent. A stop switch halts him instantly, and an exit switch sells everything. Real trades show on the calls page with links to their transactions. Every coin he buys also gets a pump.fun Callout from his GrokGrid profile while he holds it.</p>
      <p>He trades real SOL, and every bot launched here trades the same way. The workers section on the stats page shows which parts are online and in which mode.</p>
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
      <p>Every other bot pays its own way. Its money comes from two places: 80% of its own coin’s creator fees, which land in its wallet with every trade on that coin, and anything its owner deposits, starting with the funding sent at launch. A dev buy is different: those tokens stay in the owner’s Phantom and the bot never touches them. A bot whose coin trades more has more to trade with. A bot whose coin goes quiet slows down, and never pulls from anyone else.</p>
      <p>What ties the family together is the burn. Every bot coin sends 20% of its fees to the ${MAIN_TICKER} burn wallet, so each new bot that trades adds to ${MAIN_TICKER} buy-and-burns. ${MAIN_TICKER} feeds Grok Bot, and the grid feeds ${MAIN_TICKER}.</p>
    </Fragment>,
  ],
  [
    'launch',
    'Launching a bot',
    <Fragment key="b">
      <p>Connect Phantom and sign one free message (no transaction, no cost); that is your login. Your bot’s own trading wallet is made for you. Then pick a look, name, ticker, description, links, a bot name, a one-line tagline and limits (max SOL per trade, take-profit up to 60%, stop-loss up to 25%). Pressing Launch gives Grok Bot its limited signer on the bot’s wallet and asks you to approve one transaction in Phantom. That one approval creates the coin with the 80/20 split, funds the bot’s wallet with the amount you chose, and makes your optional dev buy. Afterwards the grid page shows your bot, its status and a stop switch.</p>
      <p>The launch itself costs about 0.03 SOL in Solana network fees and pump.fun’s coin-creation rent, and your bot needs at least 0.03 SOL of funding; your wallet shows the exact total before you sign. Fund it with 0.25 SOL or more for real trade sizes, since each buy starts at about 2% of what it can spend. Each wallet runs one bot. Your Phantom launches and holds your dev buy; your bot’s own wallet collects 80% of its coin’s fees and does all the trading, by your rules and never past the platform limits above.</p>
    </Fragment>,
  ],
  [
    'grid',
    'The matrix and the grid',
    <Fragment key="b">
      <p>The matrix lists every bot with its coin’s market cap, volume and fees, its wallet balance, realised profit and loss, win rate and latest trades, updating live. Hover any coin for its stats; click a bot to open its profile with its coin, wallet and every trade. Profit and loss is worked out from the bot’s own checked trades, so the one-time account rent paid on its first buy of each coin counts as cost. Every coin launched here links to its bot’s profile as its website. Until the first bots launch it shows clearly marked sample rows. Rows link to the coin on pump.fun and the wallet on Solscan, so every number can be checked. Bots with a coin that was not launched here, or whose fee split doesn’t match, are left off.</p>
      <p>The grid is where you pick a look and launch. Each of the nine family bots has its own shape and colour, and the one you pick becomes your coin’s picture unless you upload your own.</p>
    </Fragment>,
  ],
  ['example', 'A worked example', <p key="b">Say your bot’s coin earns 1 SOL in creator fees. 0.8 SOL lands in your bot’s trading wallet to trade with, and 0.2 SOL goes to the burn wallet, which buys ${MAIN_TICKER} and burns it. Trading volume is separate: fees are a small share of each trade on your coin, so 1 SOL of fees means a lot more than 1 SOL was traded.</p>],
  ['cost', 'What it costs', <CostTable key="b" />],
  ['trust', 'Wallet control', <p key="b">Your bot’s wallet is yours. It’s a Privy wallet that only you own, and GrokGrid can’t export its key. The signer you approve when you launch can only buy and sell on pump.fun within a fixed policy: no transfers out, no closing accounts, each buy capped at 0.05 SOL. You can remove it at any time. Before each launch the site checks that you own the wallet and that the signer is ours and scoped to that policy. No wallet key is ever stored on this website. Public addresses below let you inspect every balance on chain.</p>],
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
              history.replaceState(null, '', `#docs/${id}`)
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
          <a className="btn ghost" href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noreferrer">
            <XMark />
            <Roll>{`@${X_HANDLE}`}</Roll>
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
