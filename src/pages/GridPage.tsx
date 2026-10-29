import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { MAIN_TICKER } from '../config'
import { STEPS, launchBot, svgToImage, toImage } from '../data/launch'
import { fetchLaunchStatus, unavailableLaunchStatus, type LaunchStatus } from '../data/launchStatus'
import { connectWallet, rejected } from '../data/wallet'
import type { AgentWalletSession } from '../data/agentWallet'
import { AgentWalletSetup } from '../ui/AgentWalletSetup'
import type { AgentsFeed } from '../data/types'
import { BODY, FAMILY, type Shape } from '../ui/BotMark'
import { eyeInk, eyePaths } from '../ui/eyes'
import { LiveBot, type Habit } from '../ui/LiveBot'
import { Roll } from '../ui/Roll'
import { Page, Section } from './Page'

// What each one of the family does while it waits, and what it says when you point at it.
// each one has its own idle habit and its own hover move
const CAST: { habit: Habit; say: string; trick: string }[] = [
  { habit: 'look', say: 'i watch the whales', trick: 'backflip' },
  { habit: 'bounce', say: 'pick me pick me', trick: 'boing' },
  { habit: 'float', say: 'i only buy dips', trick: 'wobble' },
  { habit: 'sway', say: 'steady hands', trick: 'turn' },
  { habit: 'tilt', say: 'hmm, that chart', trick: 'roll' },
  { habit: 'flip', say: 'full send', trick: 'frontflip' },
  { habit: 'hop', say: 'up only', trick: 'twirl' },
  { habit: 'squish', say: 'i hold forever', trick: 'squash' },
  { habit: 'doze', say: 'wake me at 2x', trick: 'wake' },
]

// Everything pump.fun asks for when a coin is created, plus how the bot should trade.
interface Draft {
  look: number
  name: string
  ticker: string
  description: string
  x: string
  telegram: string
  strategy: string
  maxSol: string
  takeProfit: string
  stopLoss: string
  firstBuy: string
}

const EMPTY: Draft = { look: 3, name: '', ticker: '', description: '', x: '', telegram: '', strategy: '', maxSol: '0.05', takeProfit: '100', stopLoss: '30', firstBuy: '' }
const DRAFT_KEY = 'gg-launch-draft'
const MAX_TRADE = 0.05 // the signer policy's per-buy cap: a higher max could never be used
const LIMITS = { name: 32, ticker: 10, description: 600, strategy: 140 }
const IMAGE_MAX = 4 * 1024 * 1024
const bytes = (s: string) => new TextEncoder().encode(s).length

// What a field says is wrong with it, or nothing.
function check(d: Draft) {
  const e: Partial<Record<keyof Draft | 'image', string>> = {}
  if (!d.name.trim()) e.name = 'give it a name'
  else if (bytes(d.name) > LIMITS.name) e.name = `${LIMITS.name} bytes at most`
  if (!d.ticker) e.ticker = 'pick a ticker'
  else if (!/^[A-Z0-9]{2,10}$/.test(d.ticker)) e.ticker = '2 to 10 letters or numbers'
  if (bytes(d.description) > LIMITS.description) e.description = `${LIMITS.description} bytes at most`
  if (d.x && !/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?$/.test(d.x)) e.x = 'an x.com link to a profile or post'
  if (d.telegram && !/^https:\/\/t\.me\/[A-Za-z0-9_+]{3,}\/?$/.test(d.telegram)) e.telegram = 'a t.me link'
  if (!d.strategy.trim()) e.strategy = 'one line on how it trades'
  const n = (v: string, lo: number, hi: number) => v !== '' && !(Number(v) >= lo && Number(v) <= hi)
  if (n(d.maxSol, 0.01, MAX_TRADE)) e.maxSol = `0.01 to ${MAX_TRADE} SOL`
  if (n(d.takeProfit, 5, 10000)) e.takeProfit = '5% to 10,000%'
  if (n(d.stopLoss, 1, 95)) e.stopLoss = '1% to 95%'
  if (d.firstBuy && !(Number(d.firstBuy) === 0 || (Number(d.firstBuy) >= 0.001 && Number(d.firstBuy) <= 10))) e.firstBuy = '0, or 0.001 to 10 SOL'
  return e
}

export function GridPage({ grid }: { grid: AgentsFeed }) {
  const [d, setD] = useState<Draft>(() => {
    try {
      return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '') as Partial<Draft>) }
    } catch {
      return EMPTY
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    } catch {
      /* private mode */
    }
  }, [d])
  const [image, setImage] = useState<{ url: string; name: string } | null>(null)
  const [agentWallet, setAgentWallet] = useState<AgentWalletSession | null>(null)
  const me = agentWallet?.address ?? ''
  const onWalletChange = useCallback((wallet: AgentWalletSession | null) => setAgentWallet(wallet), [])
  const status = useLaunchStatus(me)
  const [connecting, setConnecting] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [fail, setFail] = useState('')
  const [made, setMade] = useState<{ mint: string; name: string } | null>(null)
  const [imgErr, setImgErr] = useState('')
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [cheer, setCheer] = useState(0)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const touch = (k: keyof Draft) => setTouched((t) => ({ ...t, [k]: true }))

  const look = FAMILY[d.look]
  const errs = check(d)
  const botPic = useMemo(() => botImage(d.look), [d.look])
  const pic = image?.url ?? botPic
  // The server decides: launches open only with a live bot runner and the owner's switch on.
  const ready = !!agentWallet?.authorizationReady && !!status?.open && Object.keys(errs).length === 0 && step === null && !connecting && !made
  const mine = grid.mode === 'live' ? grid.agents.filter((a) => !a.house && a.coin.real !== false) : []
  const userBots = mine.length
  const err = (k: keyof Draft) => (touched[k] ? errs[k] : undefined)

  async function launch(e: FormEvent) {
    e.preventDefault()
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])))
    if (!ready) return
    setFail('')
    setMade(null)
    const w = agentWallet?.wallet
    if (!w) return setFail('Set up your embedded agent wallet first.')
    setConnecting(true)
    try {
      // Read the wallet's current account; a previously connected account may have changed.
      const addr = await connectWallet(w)
      if (addr !== agentWallet?.address) throw Error('Agent wallet changed. Verify setup again.')
      const current = await fetchLaunchStatus(addr, AbortSignal.timeout(8_000)).catch(() => unavailableLaunchStatus())
      if (!current.open) throw Error(current.reason ?? 'Launching is paused.')
      const picture = image?.url ?? (await svgToImage(botPic))
      const r = await launchBot({
        wallet: w,
        launcher: addr,
        walletId: agentWallet.walletId,
        accessToken: agentWallet.accessToken,
        image: picture,
        onStep: setStep,
        draft: { ...d, maxSol: Number(d.maxSol || MAX_TRADE), takeProfit: Number(d.takeProfit || 100), stopLoss: Number(d.stopLoss || 30) },
      })
      setMade({ mint: r.mint, name: d.name })
      setD(EMPTY)
      setImage(null)
      setTouched({})
    } catch (err) {
      setFail(rejected(err) ? 'wallet approval cancelled. if a transaction was already submitted, wait for its confirmation before trying again.' : (err as Error).message)
    } finally {
      setConnecting(false)
      setStep(null)
    }
  }

  return (
    <Page say="make me a sibling" n={5} label="the grid" title="Launch a bot" sub={`one agent per wallet, with its own coin on pump.fun. create a wallet you own before launch. that same wallet launches and trades for its agent. ${status?.open ? 'launches are open.' : 'launches open once the bot runner is live.'}`}>
      <AgentWalletSetup onWalletChange={onWalletChange} />
      <div className="gd-line" role="radiogroup" aria-label="pick a bot">
        {FAMILY.map((f, i) => (
          <button
            key={f.name}
            role="radio"
            aria-checked={i === d.look}
            className={`gd-pick gd-${CAST[i].trick} ${i === d.look ? 'on' : ''}`}
            style={{ '--in': `${0.25 + i * 0.07}s` } as CSSProperties}
            onClick={() => {
              set('look', i)
              setCheer((n) => n + 1)
            }}
          >
            <LiveBot color={f.color} shape={f.shape} habit={CAST[i].habit} say={CAST[i].say} size={120} delay={i * -0.37} />
            <span className="gd-name">{f.name}</span>
          </button>
        ))}
      </div>

      <div className="gd-build">
        <div className="gd-side">
          <div className="card gd-preview">
            <LiveBot key={`${d.look}-${cheer}`} color={look.color} shape={look.shape} habit={CAST[d.look].habit} size={170} selected />
            <b>{d.name || 'your bot'}</b>
            <span>{d.strategy || 'one line on how it trades'}</span>
          </div>
          {/* how the coin will look on pump.fun */}
          <div className="card gd-coin">
            <span className="st-k mono">on pump.fun</span>
            <div className="gd-coin-top">
              <img src={pic} alt="" />
              <div>
                <b>{d.name || 'coin name'}</b>
                <span className="mono">${d.ticker || 'TICKER'}</span>
              </div>
            </div>
            <p>{d.description || 'what the coin is about.'}</p>
            <div className="gd-links mono">
              <span>web · grokgrid profile</span>
              {d.x && <span>x</span>}
              {d.telegram && <span>telegram</span>}
              <span className="dim">launched on grokgrid</span>
            </div>
          </div>
        </div>

        <form className="card gd-form" onSubmit={launch} noValidate>
          <Group n="01" title="the coin">
            <div className="gd-img">
              <img src={pic} alt="coin image" />
              <div>
                <label className="btn ghost gd-upload">
                  <Roll>{image ? 'Change image' : 'Upload image'}</Roll>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      if (f.size > IMAGE_MAX) return setImgErr('4 MB at most')
                      setImgErr('')
                      toImage(f).then((url) => setImage({ url, name: f.name }), (err: Error) => setImgErr(err.message))
                    }}
                  />
                </label>
                {image && (
                  <button type="button" className="gd-reset" onClick={() => setImage(null)}>
                    use my bot instead
                  </button>
                )}
                <small>{imgErr || (image ? image.name : 'png, jpg, gif or webp, up to 4 MB. your bot is the picture until you pick one.')}</small>
              </div>
            </div>
            <div className="gd-row">
              <Field label="name" count={`${bytes(d.name)}/${LIMITS.name}`} error={err('name')}>
                <input
                  value={d.name}
                  placeholder="night shift"
                  onBlur={() => touch('name')}
                  onChange={(e) => {
                    const name = e.target.value
                    // the ticker fills itself from the name until you type your own
                    setD((x) => ({ ...x, name, ticker: touched.ticker ? x.ticker : tickerFrom(name) }))
                  }}
                />
              </Field>
              <Field label="ticker" count={`${d.ticker.length}/${LIMITS.ticker}`} error={err('ticker')} narrow>
                <input value={d.ticker} placeholder="NIGHT" onBlur={() => touch('ticker')} onChange={(e) => { touch('ticker'); set('ticker', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)) }} />
              </Field>
            </div>
            <Field label="description" count={`${bytes(d.description)}/${LIMITS.description}`} error={err('description')}>
              <textarea rows={3} value={d.description} placeholder="a grok bot that trades the night shift so you can sleep." onBlur={() => touch('description')} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </Group>

          <Group n="02" title="socials" note="optional · its website is its grokgrid profile">
            <div className="gd-row">
              <Field label="x" error={err('x')}>
                <input inputMode="url" value={d.x} placeholder="https://x.com/yourbot" onBlur={() => touch('x')} onChange={(e) => set('x', e.target.value.trim())} />
              </Field>
              <Field label="telegram" error={err('telegram')}>
                <input inputMode="url" value={d.telegram} placeholder="https://t.me/yourbot" onBlur={() => touch('telegram')} onChange={(e) => set('telegram', e.target.value.trim())} />
              </Field>
            </div>
          </Group>

          <Group n="03" title="how it trades">
            <Field label="strategy" count={`${bytes(d.strategy)}/${LIMITS.strategy}`} error={err('strategy')}>
              <input value={d.strategy} placeholder="only buys coins under 30K, sells at 2x" onBlur={() => touch('strategy')} onChange={(e) => set('strategy', e.target.value)} />
            </Field>
            <div className="gd-row three">
              <Field label="max per trade" unit="SOL" hint={`signer cap: ${MAX_TRADE}`} error={err('maxSol')}>
                <input inputMode="decimal" value={d.maxSol} onBlur={() => touch('maxSol')} onChange={(e) => set('maxSol', num(e.target.value))} />
              </Field>
              <Field label="take profit" unit="%" error={err('takeProfit')}>
                <input inputMode="decimal" value={d.takeProfit} onBlur={() => touch('takeProfit')} onChange={(e) => set('takeProfit', num(e.target.value))} />
              </Field>
              <Field label="stop loss" unit="%" error={err('stopLoss')}>
                <input inputMode="decimal" value={d.stopLoss} onBlur={() => touch('stopLoss')} onChange={(e) => set('stopLoss', num(e.target.value))} />
              </Field>
            </div>
          </Group>

          <Group n="04" title="launch">
            <Field label="first buy" unit="SOL" error={err('firstBuy')} hint="optional. included in the coin-launch transaction you review in your wallet.">
              <input inputMode="decimal" value={d.firstBuy} placeholder="0" onBlur={() => touch('firstBuy')} onChange={(e) => set('firstBuy', num(e.target.value))} />
            </Field>
            <div className="gd-split">
              <div>
                <b>80%</b>
                <span>of creator fees go to your agent wallet — the same address that launches and trades</span>
              </div>
              <div>
                <b>20%</b>
                <span>of creator fees go to the ${MAIN_TICKER} burn wallet</span>
              </div>
            </div>
            <p className="gd-note">Your bot can only trade inside the policy you approve for its signer, never past the platform limits, and you can remove the signer at any time.</p>
            <p className="gd-note mono">one agent per wallet · 80/20 split locked at creation · review the exact network fees, rent and optional first buy before signing</p>
            <button type="submit" className="btn" disabled={!ready}>
              <Roll>{step !== null ? STEPS[step] : status === null ? 'Checking launchpad…' : !status.open ? 'Launches paused' : !agentWallet?.authorizationReady ? 'Set up your agent wallet' : 'Launch bot'}</Roll>
            </button>
            {me && <p className="gd-note mono">launcher + trading wallet: <span style={{ overflowWrap: 'anywhere' }}>{me}</span></p>}
            {step !== null && (
              <ol className="gd-steps mono" aria-live="polite">
                {STEPS.map((t, i) => (
                  <li key={t} className={i < step ? 'done' : i === step ? 'on' : ''}>{t}</li>
                ))}
              </ol>
            )}
            {made && (
              <p className="gd-made">
                {made.name}’s coin is confirmed. <a href={`https://pump.fun/coin/${made.mint}`} target="_blank" rel="noreferrer">see it on pump.fun</a>. registration does not by itself start trading or grant spending permission.
              </p>
            )}
            <p className={`gd-note ${fail ? 'bad' : ''}`}>
              {fail ||
                (made
                  ? 'this wallet has its agent. its creator-fee allocation stays 80% to this wallet and 20% to the burn wallet.'
                  : status === null
                  ? 'checking the launchpad'
                  : !status.open
                    ? `${status.reason ?? 'launching is closed right now.'} your draft stays saved in this tab, except the picture.`
                    : Object.keys(errs).length
                        ? 'fill in the fields marked above to launch.'
                        : 'review the launch and locked fee split in your wallet. trading requires separate execution readiness.')}
            </p>
          </Group>
        </form>
      </div>

      <Section title="On the grid" note={`${userBots} launched`}>
        {mine.length ? (
          <div className="gd-list">
            {mine.map((a) => (
              <a key={a.id} className="card gd-bot" href={`https://pump.fun/coin/${a.coin.mint}`} target="_blank" rel="noreferrer">
                <LiveBot color={a.color} shape={a.shape as Shape} habit="float" size={40} />
                <b>{a.name}</b>
                <span className="mono">${a.coin.symbol}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="card gd-empty">
            <LiveBot color="#0b0b0b" shape="sphere" habit="doze" size={44} />
            <span>no user bots yet. the first ones line up in the matrix, ranked by market cap.</span>
          </div>
        )}
      </Section>
    </Page>
  )
}

function Group({ n, title, note, children }: { n: string; title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="gd-group">
      <legend>
        <span className="mono">{n}</span> {title} {note && <em className="mono">{note}</em>}
      </legend>
      {children}
    </fieldset>
  )
}

function Field({ label, count, error, unit, hint, narrow, children }: { label: string; count?: string; error?: string; unit?: string; hint?: string; narrow?: boolean; children: ReactNode }) {
  return (
    <label className={`gd-field ${error ? 'bad' : ''} ${narrow ? 'narrow' : ''}`}>
      <span className="gd-label">
        {label}
        {count && <i>{count}</i>}
      </span>
      <span className="gd-input">
        {children}
        {unit && <b className="mono">{unit}</b>}
      </span>
      {(error || hint) && <small>{error ?? hint}</small>}
    </label>
  )
}

const num = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
const tickerFrom = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)

// The bot drawn as a square coin picture, used until the owner uploads their own.
function botImage(look: number) {
  const f = FAMILY[look]
  const eyes = eyePaths(f.shape, 0.3, -0.2).map((d) => `<path d="${d}" fill="${eyeInk(f.color)}"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -14 128 128"><rect x="-14" y="-14" width="128" height="128" fill="#f2f3f5"/><path d="${BODY[f.shape]}" fill="${f.color}"/>${eyes}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// Recheck after each completed request; account changes never reuse the previous result.
function useLaunchStatus(launcher: string) {
  const [result, setResult] = useState<{ launcher: string; status: LaunchStatus } | null>(null)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    async function load() {
      const status = await fetchLaunchStatus(launcher, AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]))
        .catch(() => unavailableLaunchStatus())
      if (!live) return
      setResult({ launcher, status })
      timer = setTimeout(load, 20_000)
    }
    void load()
    return () => {
      live = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [launcher])
  return result?.launcher === launcher ? result.status : null
}
