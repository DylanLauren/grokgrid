import { useEffect, useRef, type Ref } from 'react'
import type { Call } from '../data/types'
import { solscan } from '../config'
import { ago, mc, signedUsd, tokens, usd } from '../lib/format'
import { BotMark } from './BotMark'
import { CoinChip } from './CoinChip'
import './callcard.css'

// A callout in the pump.fun position format: his note on top, the position under it.
// onOpen turns the card into a button (the dock opens the calls panel with it);
// otherwise a call with a signature links to its transaction.
export function CallCard({ call, compact, onOpen, focus }: { call: Call; compact?: boolean; onOpen?: () => void; focus?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])
  const cls = `cc ${compact ? 'cc-compact' : ''} ${onOpen ? 'cc-open' : ''} ${focus ? 'cc-focus' : ''}`
  if (onOpen)
    return (
      <button ref={ref as Ref<HTMLButtonElement>} type="button" className={cls} onClick={onOpen} aria-label={`open call: ${call.side} ${call.symbol}`}>
        <Body call={call} compact={compact} />
      </button>
    )
  const Wrap = call.sig ? 'a' : 'div'
  return (
    <Wrap ref={ref as never} className={cls} {...(call.sig ? { href: solscan('tx', call.sig), target: '_blank', rel: 'noreferrer' } : {})}>
      <Body call={call} compact={compact} />
    </Wrap>
  )
}

// Same layout as a pump.fun callout: avatar column, name and time, the note, the position
// box, then the action row. Buy and sell use pump.fun's solid green and red tags.
function Body({ call, compact }: { call: Call; compact?: boolean }) {
  return (
    <>
      <span className="cc-av">
        <BotMark size={compact ? 26 : 30} />
      </span>
      <div className="cc-main">
        <div className="cc-head">
          <span className="cc-who">grokgrid</span>
          <span className="cc-ago">{ago(call.ts)}</span>
          <span className={`cc-side is-${call.side}`}>{call.side === 'buy' ? 'Buy' : 'Sell'}</span>
        </div>
        <p className="cc-note">{call.note}</p>
        <div className="cc-pos">
          <CoinChip call={call} size={36} />
          <div className="cc-coin">
            <b>{call.name}</b>
            <span>{call.symbol}</span>
          </div>
          <div className="cc-nums">
            <span><i>Size</i>{tokens(call.sizeTokens)} {call.symbol}</span>
            <span><i>Position</i>{usd(call.positionUsd)}</span>
            <span><i>Profit</i><em className={call.pnlUsd === null ? 'dim' : call.pnlUsd >= 0 ? 'gain' : 'loss'}>{signedUsd(call.pnlUsd)}</em></span>
          </div>
          <div className="cc-foot">
            <span><i>{call.side === 'sell' ? 'SOL in' : 'SOL out'}</i>{call.spentSol} SOL</span>
            <span><i>Avg entry</i>{mc(call.entryMc)} → {mc(call.nowMc)} MC</span>
          </div>
        </div>
        {!compact && (
          <div className="cc-acts">
            <Icon d={SHARE} />
            <Icon d={TARGET} />
            {call.sample && <span className="cc-tag">sample trade</span>}
            {call.verified && call.verification === 'wallet-balance-movements' && <span className="cc-tag ok" title="Finalized wallet token and SOL movements checked; profit is not verified">wallet flows checked</span>}
          </div>
        )}
      </div>
    </>
  )
}

const SHARE = 'M8 10V2.5M5 5.2 8 2.2l3 3M3.5 8.5v4.2c0 .5.4.8.8.8h7.4c.5 0 .8-.3.8-.8V8.5'
const TARGET = 'M8 2v2.2M8 11.8V14M2 8h2.2M11.8 8H14M8 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z'

function Icon({ d }: { d: string }) {
  return (
    <svg className="cc-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
