import type { Call } from '../data/types'
import { solscan } from '../config'
import { ago, mc, signedUsd, tokens, usd } from '../lib/format'
import { BotMark } from './BotMark'
import { CoinChip } from './CoinChip'
import './callcard.css'

// A callout in the pump.fun position format: his note on top, the position under it.
export function CallCard({ call, compact }: { call: Call; compact?: boolean }) {
  const Wrap = call.sig ? 'a' : 'div'
  return (
    <Wrap className={`cc ${compact ? 'cc-compact' : ''}`} {...(call.sig ? { href: solscan('tx', call.sig), target: '_blank', rel: 'noreferrer' } : {})}>
      <div className="cc-head">
        <BotMark size={22} />
        <span className="cc-who">grokgrid</span>
        <span className={`cc-side mono ${call.side}`}>{call.side}</span>
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
    </Wrap>
  )
}
