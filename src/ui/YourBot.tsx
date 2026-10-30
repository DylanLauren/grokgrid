import { useState } from 'react'
import type { Agent } from '../data/types'
import type { AgentWalletSession } from '../data/agentWallet'
import { ago, sol } from '../lib/format'
import { whyOf } from '../lib/why'
import { LiveBot } from './LiveBot'
import type { Shape } from './BotMark'

// The connected owner's own bot: how it's doing, the rules it trades by, and the switch.
// Trading rules can only be tighter than the house's, so the card shows what really applies.
const HOUSE = { maxSol: 0.05, takeProfit: 60, stopLoss: 25 }
// each style's own exits (matches the engine); bots launched before styles trade as steady
const STYLE_EXITS = { early: { takeProfit: 35, stopLoss: 15 }, momentum: { takeProfit: 45, stopLoss: 20 }, steady: { takeProfit: 60, stopLoss: 25 } }

export function YourBot({ bot, pending, wallet }: { bot?: Agent; pending?: { mint: string; name: string }; wallet: AgentWalletSession | null }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const mint = bot?.coin.mint ?? pending?.mint
  if (!mint) return null
  const mine = !!wallet && (!bot || bot.wallet === wallet.address)
  const trading = mine && wallet.authorizationReady
  const r = bot?.rules
  const style = r?.style ?? 'steady', cap = STYLE_EXITS[style]
  const rules: [string, string][] = [
    ['style', style],
    ['max per trade', `${sol(Math.min(r?.maxSol ?? HOUSE.maxSol, HOUSE.maxSol))} SOL`],
    ['take profit', `+${Math.min(r?.takeProfit ?? cap.takeProfit, cap.takeProfit)}%`],
    ['stop loss', `-${Math.min(r?.stopLoss ?? cap.stopLoss, cap.stopLoss)}%`],
  ]
  const last = bot?.recent?.[0]
  const why = whyOf(last?.note)

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true); setNote('')
    try { await fn(); setNote(done) } catch { setNote('That didn’t go through. Nothing changed.') }
    finally { setBusy(false) }
  }

  return (
    <section className="card yb" aria-label="your bot">
      <div className="yb-who">
        {bot ? <LiveBot color={bot.color} shape={bot.shape as Shape} habit="float" size={64} /> : <LiveBot color="#ffffff" shape="sphere" habit="bounce" size={64} />}
        <div className="yb-name">
          <span className="st-k mono">your bot</span>
          <b>{bot?.name ?? pending?.name}</b>
          <span className="mono">{bot ? `$${bot.coin.symbol}` : 'joining the grid…'}</span>
        </div>
        <span className={`yb-state mono ${trading ? 'on' : ''}`}>{!bot ? 'setting up' : trading ? 'trading' : mine ? 'paused' : 'watching'}</span>
      </div>

      {bot ? (
        <dl className="yb-stats">
          <div><dt>wallet</dt><dd>{sol(bot.walletSol)} SOL</dd></div>
          <div><dt>p&amp;l</dt><dd className={bot.pnlSol === null ? '' : bot.pnlSol >= 0 ? 'up' : 'down'}>{bot.pnlSol === null ? '–' : `${bot.pnlSol >= 0 ? '+' : ''}${sol(bot.pnlSol)} SOL`}</dd></div>
          <div><dt>trades</dt><dd>{bot.trades}{bot.winRate !== null ? ` · ${Math.round(bot.winRate)}% wins` : ''}</dd></div>
          {rules.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      ) : (
        <p className="yb-line">your coin is confirmed. the bot shows up here and in the matrix within a minute, then starts looking for its first trade.</p>
      )}

      {last && <p className="yb-line"><span className="mono">{last.side === 'buy' ? 'bought' : 'sold'} ${last.symbol} · {ago(last.ts)}</span>{why && <> · {why}</>}</p>}
      {bot && !last && <p className="yb-line">no trades yet. it buys only coins that pass the house safety screen, so the first one can take a while.</p>}

      <div className="yb-act">
        <a className="btn" href={`#matrix/${mint}`}>Open its profile</a>
        <a className="btn ghost" href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer">pump.fun</a>
        {mine && wallet.stop && <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(wallet.stop!, 'Stopped. Your bot can no longer trade its wallet.')}>Stop trading</button>}
        {mine && !wallet.authorizationReady && wallet.authorize && <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(wallet.authorize!, 'Trading is back on, inside the same limits.')}>Resume trading</button>}
      </div>
      {!wallet && bot && <p className="yb-line dim">connect the Phantom that launched it to stop or resume trading.</p>}
      <p role="status" aria-live="polite" className="yb-line dim">{busy ? 'confirm in the wallet window…' : note}</p>
    </section>
  )
}
