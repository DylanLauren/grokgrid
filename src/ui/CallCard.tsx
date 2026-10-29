import { useEffect, useRef, type PointerEvent, type Ref } from 'react'
import type { Call } from '../data/types'
import { solscan } from '../config'
import { ago, mc, signedUsd, tokens, usd } from '../lib/format'
import { BotMark } from './BotMark'
import { CoinChip } from './CoinChip'
import './callcard.css'

// A callout in the pump.fun position format: his note on top, the position under it.
// onOpen turns the card into a button (the dock opens the calls panel with it);
// otherwise a call with a signature links to its transaction.
export function CallCard({ call, compact, onOpen, focus }: { call: Call; compact?: boolean; onOpen?: (card: HTMLElement) => void; focus?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])
  const cls = `cc cc-${call.side} ${compact ? 'cc-compact' : ''} ${onOpen ? 'cc-open' : ''} ${focus ? 'cc-focus' : ''}`
  if (onOpen)
    return (
      <button ref={ref as Ref<HTMLButtonElement>} type="button" className={cls} onClick={(e) => onOpen(e.currentTarget)} onPointerMove={spotlight} aria-label={`open call: ${call.side} ${call.symbol}`}>
        <Body call={call} compact={compact} />
      </button>
    )
  const Wrap = call.sig ? 'a' : 'div'
  return (
    <Wrap ref={ref as never} className={cls} onPointerMove={spotlight} {...(call.sig ? { href: solscan('tx', call.sig), target: '_blank', rel: 'noreferrer' } : {})}>
      <Body call={call} compact={compact} />
    </Wrap>
  )
}

// Hover glow follows the pointer: the card's CSS reads these two variables.
function spotlight(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
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
            {call.positionUsd !== null && <span><i>Position</i>{usd(call.positionUsd)}</span>}
            {call.pnlUsd !== null && <span><i>Profit</i><em className={call.pnlUsd >= 0 ? 'gain' : 'loss'}>{signedUsd(call.pnlUsd)}</em></span>}
          </div>
          <div className="cc-foot">
            <span><i>{call.side === 'sell' ? 'SOL in' : 'SOL out'}</i>{call.spentSol} SOL</span>
            {call.tradeMc ? <span><i>At</i>{call.tradeMcApprox ? '≈' : ''}{mc(call.tradeMc)} MC</span> : call.entryMc !== null && call.nowMc !== null && <span><i>Avg entry</i>{mc(call.entryMc)} → {mc(call.nowMc)} MC</span>}
            {call.side === 'sell' && typeof call.pnlSol === 'number' && <span><i>P&L</i><em className={call.pnlSol >= 0 ? 'gain' : 'loss'}>{call.pnlSol >= 0 ? '+' : ''}{call.pnlSol.toFixed(5)} SOL</em></span>}
          </div>
        </div>
        {(call.sample || (!compact && call.verified && call.verification === 'wallet-balance-movements')) && (
          <div className="cc-acts">
            {call.sample && <span className="cc-tag">sample trade</span>}
            {/* the whole card already links to the transaction, so this reads as its button */}
            {!compact && call.verified && call.verification === 'wallet-balance-movements' && call.sig && <span className="cc-tx" title="Open this transaction on Solscan"><img src="/brands/solscan.png" alt="" width={14} height={14} />check tx</span>}
          </div>
        )}
      </div>
    </>
  )
}
