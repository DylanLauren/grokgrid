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

function Body({ call, compact }: { call: Call; compact?: boolean }) {
  return (
    <>
      <div className="cc-head">
        <BotMark size={22} />
        <span className="cc-who">grokgrid</span>
        <span className={`cc-side mono is-${call.side}`}>{call.side}</span>
        {call.sample && <span className="cc-ok mono">sample trade</span>}
        {call.verified && <span className="cc-ok mono" title="signature found on chain, signed by his wallet">on chain ✓</span>}
        <span className="cc-ago mono">{ago(call.ts)}</span>
      </div>
      <p className="cc-note">{call.note}</p>
      <div className="cc-pos">
        <CoinChip call={call} size={compact ? 30 : 36} />
        <div className="cc-coin">
          <b>{call.name}</b>
          <span>{call.symbol}</span>
        </div>
        <div className="cc-nums">
          <span><i>Size</i>{tokens(call.sizeTokens)} {call.symbol}</span>
          <span><i>Position</i>{usd(call.positionUsd)}</span>
          <span><i>Profit</i><em className={call.pnlUsd >= 0 ? 'gain' : 'loss'}>{signedUsd(call.pnlUsd)}</em></span>
        </div>
        <div className="cc-foot">
          <span><i>Spent</i>{call.spentSol} SOL</span>
          <span><i>Avg entry</i>{mc(call.entryMc)} → {mc(call.nowMc)} MC</span>
        </div>
      </div>
    </>
  )
}
