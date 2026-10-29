import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { MAIN_TICKER } from '../config'
import { STEPS, launchBot, svgToImage, toImage } from '../data/launch'
import { fetchLaunchStatus, unavailableLaunchStatus, type LaunchStatus } from '../data/launchStatus'
import { connectWallet, rejected } from '../data/wallet'
import type { AgentWalletSession } from '../data/agentWallet'
import { AgentWalletSetup, type OwnerWallet } from '../ui/AgentWalletSetup'
import type { AgentsFeed } from '../data/types'
import { BODY, FAMILY, type Shape } from '../ui/BotMark'
import { eyeInk, eyePaths } from '../ui/eyes'
import { LiveBot, type Habit } from '../ui/LiveBot'
import { Roll } from '../ui/Roll'
import { YourBot } from '../ui/YourBot'
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
  botName: string // blank means the bot shares the coin's name
  ticker: string
  description: string
  x: string
  telegram: string
  strategy: string
  maxSol: string
  takeProfit: string
  stopLoss: string
  firstBuy: string
  fund: string // SOL sent from the owner's wallet to the bot's trading wallet at launch
}

const EMPTY: Draft = { look: 3, name: '', botName: '', ticker: '', description: '', x: '', telegram: '', strategy: '', maxSol: '0.05', takeProfit: '60', stopLoss: '25', firstBuy: '', fund: '0.05' }
const DRAFT_KEY = 'gg-launch-draft'
// the house exits every bot runs under: an owner can set them tighter, never looser
const HOUSE = { takeProfit: 60, stopLoss: 25 }
// what a launch needs from the owner's Phantom, matching api/launch/prepare.ts
const MIN_FUND = 0.05 // matches MIN_FUND_SOL in api/launch/prepare.ts
const LAUNCH_COST = 0.03 // about: Solana network fees and pump.fun's coin-creation rent
const MAX_TRADE = 0.05 // the signer policy's per-buy cap: a higher max could never be used
const LIMITS = { name: 32, botName: 32, ticker: 10, description: 600, strategy: 140 }
const RESERVED = ['house', 'housetrader', 'housebot', 'grokgrid', 'grokgridofficial', 'official', 'admin'] // matches api/_launch.ts
const bytes = (s: string) => new TextEncoder().encode(s).length

// What a field says is wrong with it, or nothing.
function check(d: Draft) {
  const e: Partial<Record<keyof Draft | 'image', string>> = {}
  if (!d.name.trim()) e.name = 'give it a name'
  else if (bytes(d.name) > LIMITS.name) e.name = `${LIMITS.name} bytes at most`
  if (bytes(d.botName) > LIMITS.botName) e.botName = `${LIMITS.botName} bytes at most`
  else if (RESERVED.includes((d.botName.trim() || d.name).toLowerCase().replace(/[^a-z0-9]/g, ''))) e.botName = 'that name belongs to the house'
  if (!d.ticker) e.ticker = 'pick a ticker'
  else if (!/^[A-Z0-9]{2,10}$/.test(d.ticker)) e.ticker = '2 to 10 letters or numbers'
  if (bytes(d.description) > LIMITS.description) e.description = `${LIMITS.description} bytes at most`
  if (d.x && !/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?$/.test(d.x)) e.x = 'an x.com link to a profile or post'
  if (d.telegram && !/^https:\/\/t\.me\/[A-Za-z0-9_+]{3,}\/?$/.test(d.telegram)) e.telegram = 'a t.me link'
  if (!d.strategy.trim()) e.strategy = 'one line for its profile'
  const n = (v: string, lo: number, hi: number) => v !== '' && !(Number(v) >= lo && Number(v) <= hi)
  if (n(d.maxSol, 0.01, MAX_TRADE)) e.maxSol = `0.01 to ${MAX_TRADE} SOL`
  if (n(d.takeProfit, 5, HOUSE.takeProfit)) e.takeProfit = `5% to ${HOUSE.takeProfit}%`
  if (n(d.stopLoss, 1, HOUSE.stopLoss)) e.stopLoss = `1% to ${HOUSE.stopLoss}%`
  if (!(Number(d.fund) >= MIN_FUND && Number(d.fund) <= 10)) e.fund = `at least ${MIN_FUND} SOL, up to 10`
  if (d.firstBuy && !(Number(d.firstBuy) === 0 || (Number(d.firstBuy) >= 0.001 && Number(d.firstBuy) <= 10))) e.firstBuy = '0, or 0.001 to 10 SOL'
  return e
}

export function GridPage({ grid }: { grid: AgentsFeed }) {
  // the form starts empty every time: leaving the page or reloading resets it, so an abandoned
  // launch never leaves anything half-filled behind
  const [d, setD] = useState<Draft>(EMPTY)
  useEffect(() => {
    try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ }
  }, [])
  const [image, setImage] = useState<{ url: string; name: string } | null>(null)
  const [agentWallet, setAgentWallet] = useState<AgentWalletSession | null>(null)
  const [owner, setOwner] = useState<OwnerWallet | null>(null)
  // the owner's own wallet launches; the bot trades from its own wallet
  const me = owner?.address ?? ''
  // only a real change re-renders the page: same wallet, same readiness keeps the old session
  const onWalletChange = useCallback((wallet: AgentWalletSession | null) => setAgentWallet((prev) =>
    prev && wallet && prev.address === wallet.address && prev.walletId === wallet.walletId && prev.authorizationReady === wallet.authorizationReady && !!prev.authorize === !!wallet.authorize && prev.policySummary === wallet.policySummary ? prev : wallet), [])
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
  const ready = !!owner && !!(agentWallet?.authorizationReady || agentWallet?.authorize) && !!status?.open && Object.keys(errs).length === 0 && step === null && !connecting && !made
  const mine = grid.mode === 'live' ? grid.agents.filter((a) => !a.house && a.coin.real !== false) : []
  const userBots = mine.length
  // one bot per Phantom: once yours exists, the page shows it instead of the launch form
  const myBot = me ? mine.find((a) => a.owner === me || (made && a.coin.mint === made.mint)) : undefined
  const err = (k: keyof Draft) => (touched[k] ? errs[k] : undefined)

  async function launch(e: FormEvent) {
    e.preventDefault()
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])))
    if (!ready) return
    setFail('')
    setMade(null)
    const w = owner?.wallet
    if (!w || !agentWallet) return setFail('Connect Phantom and sign the message first.')
    setConnecting(true)
    try {
      // Read the wallet's current account; a previously connected account may have changed.
      const addr = await connectWallet(w)
      if (addr !== owner?.address) throw Error('Your Phantom account changed. Connect again.')
      // pressing Launch is the approval: Grok Bot gets its limited signer on this wallet now
      if (!agentWallet.authorizationReady) await agentWallet.authorize?.()
      const current = await fetchLaunchStatus(addr, AbortSignal.timeout(8_000)).catch(() => unavailableLaunchStatus())
      if (!current.open) throw Error(current.reason ?? 'Launching is paused.')
      const picture = image?.url ?? (await svgToImage(botPic))
      const r = await launchBot({
        wallet: w,
        launcher: addr,
        bot: agentWallet.address,
        fundSol: Number(d.fund),
        walletId: agentWallet.walletId,
        accessToken: agentWallet.accessToken,
        image: picture,
        onStep: setStep,
        draft: { ...d, maxSol: Number(d.maxSol || MAX_TRADE), takeProfit: Number(d.takeProfit || HOUSE.takeProfit), stopLoss: Number(d.stopLoss || HOUSE.stopLoss) },
      })
      setMade({ mint: r.mint, name: d.botName.trim() || d.name })
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
    <Page say="make me a sibling" n={5} label="the grid" title="Launch a bot" sub={`one agent per wallet, with its own coin on pump.fun. connect phantom and sign one free message. one approval launches the coin and funds your bot’s own trading wallet. ${status?.open ? 'launches are open.' : 'launches open once the bot runner is live.'}`}>
      <AgentWalletSetup onWalletChange={onWalletChange} owner={owner} onOwnerChange={setOwner} />
      {myBot || made ? <YourBot bot={myBot} pending={made ?? undefined} wallet={agentWallet} /> : (<>
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
            <b>{d.botName.trim() || d.name || 'your bot'}</b>
            <span>{d.strategy || 'its motto on the grid'}</span>
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
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
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
                <small>{imgErr || (image ? image.name : 'any picture works. it’s cropped and sized for you. your bot is the picture until you pick one.')}</small>
              </div>
            </div>
            <div className="gd-row">
              <Field label="coin name" count={`${bytes(d.name)}/${LIMITS.name}`} error={err('name')}>
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
            <Field label="bot name" count={`${bytes(d.botName)}/${LIMITS.botName}`} error={err('botName')}>
              <input value={d.botName} placeholder={d.name ? `${d.name} (or give it its own)` : 'night owl'} onBlur={() => touch('botName')} onChange={(e) => set('botName', e.target.value)} />
            </Field>
            <Field label="tagline" count={`${bytes(d.strategy)}/${LIMITS.strategy}`} error={err('strategy')} hint="its motto on the grid. every bot trades on the house engine and safety screen; the numbers below can only make it more careful.">
              <input value={d.strategy} placeholder="patient, picky, never chases a pump" onBlur={() => touch('strategy')} onChange={(e) => set('strategy', e.target.value)} />
            </Field>
            <div className="gd-row three">
              <Field label="max per trade" unit="SOL" hint={`signer cap: ${MAX_TRADE}`} error={err('maxSol')}>
                <input inputMode="decimal" value={d.maxSol} onBlur={() => touch('maxSol')} onChange={(e) => set('maxSol', num(e.target.value))} />
              </Field>
              <Field label="take profit" unit="%" hint={`${HOUSE.takeProfit}% at most`} error={err('takeProfit')}>
                <input inputMode="decimal" value={d.takeProfit} onBlur={() => touch('takeProfit')} onChange={(e) => set('takeProfit', num(e.target.value))} />
              </Field>
              <Field label="stop loss" unit="%" hint={`${HOUSE.stopLoss}% at most`} error={err('stopLoss')}>
                <input inputMode="decimal" value={d.stopLoss} onBlur={() => touch('stopLoss')} onChange={(e) => set('stopLoss', num(e.target.value))} />
              </Field>
            </div>
          </Group>

          <Group n="04" title="launch">
            <div className="gd-row">
              <Field label="fund your bot" unit="SOL" count={`min ${MIN_FUND}`} error={err('fund')} hint={`goes to your bot’s own trading wallet. ${MIN_FUND} SOL is the minimum; it keeps 0.02 in reserve and buys with about 2% of the rest, so 0.25 SOL or more gives real trades.`}>
                <input inputMode="decimal" value={d.fund} placeholder={String(MIN_FUND)} onBlur={() => touch('fund')} onChange={(e) => set('fund', num(e.target.value))} />
              </Field>
              <Field label="dev buy" unit="SOL" error={err('firstBuy')} hint="optional. your Phantom buys your own coin the moment it’s created. the tokens stay in your Phantom; the bot never trades or sells them.">
                <input inputMode="decimal" value={d.firstBuy} placeholder="0" onBlur={() => touch('firstBuy')} onChange={(e) => set('firstBuy', num(e.target.value))} />
              </Field>
            </div>
            {/* everything the one approval does, and what it costs */}
            <dl className="gd-sign">
              <div><dt>create ${d.ticker || 'TICKER'} on pump.fun, 80/20 split locked</dt><dd>≈{LAUNCH_COST} SOL fees + rent</dd></div>
              <div><dt>fund your bot’s trading wallet</dt><dd>{Number(d.fund) > 0 ? Number(d.fund) : 0} SOL</dd></div>
              <div><dt>dev buy, tokens to your Phantom</dt><dd>{Number(d.firstBuy) > 0 ? Number(d.firstBuy) : 0} SOL</dd></div>
              <div className="sum"><dt>one approval in Phantom, about</dt><dd>{+(LAUNCH_COST + (Number(d.fund) || 0) + (Number(d.firstBuy) || 0)).toFixed(3)} SOL</dd></div>
            </dl>
            <div className="gd-split">
              <div>
                <b>80%</b>
                <span>of creator fees go to your bot’s trading wallet, which collects them and trades with them</span>
              </div>
              <div>
                <b>20%</b>
                <span>of creator fees go to the ${MAIN_TICKER} burn wallet</span>
              </div>
            </div>
            <p className="gd-note">Your Phantom only signs the launch and holds your dev buy. Your bot’s own wallet collects its fees and does all the trading, only inside its fixed limits. You can stop it at any time.</p>
            <p className="gd-note mono">one bot per Phantom · 80/20 split locked at creation · your wallet shows the exact total before you sign</p>
            <button type="submit" className="btn" disabled={!ready}>
              <Roll>{step !== null ? STEPS[step] : connecting ? 'Setting up your bot’s trading permission…' : status === null ? 'Checking launchpad…' : !status.open ? 'Launches paused' : !owner ? 'Connect Phantom' : !agentWallet ? 'Sign the message in Phantom' : !(agentWallet.authorizationReady || agentWallet.authorize) ? 'Checking your wallet…' : 'Launch bot'}</Roll>
            </button>
            {me && agentWallet && <p className="gd-note mono">launches from <span style={{ overflowWrap: 'anywhere' }}>{me}</span> · trades from <span style={{ overflowWrap: 'anywhere' }}>{agentWallet.address}</span></p>}
            {step !== null && (
              <ol className="gd-steps mono" aria-live="polite">
                {STEPS.map((t, i) => (
                  <li key={t} className={i < step ? 'done' : i === step ? 'on' : ''}>{t}</li>
                ))}
              </ol>
            )}
            <p className={`gd-note ${fail ? 'bad' : ''}`}>
              {fail ||
                (status === null
                  ? 'checking the launchpad'
                  : !status.open
                    ? `${status.reason ?? 'launching is closed right now.'}`
                    : Object.keys(errs).length
                        ? 'fill in the fields marked above to launch.'
                        : 'review the launch and locked fee split in your wallet. trading requires separate execution readiness.')}
            </p>
          </Group>
        </form>
      </div>

      </>)}

      <Section title="On the grid" note={`${userBots} launched`}>
        {mine.length ? (
          <div className="gd-list">
            {mine.map((a) => (
              <a key={a.id} className="card gd-bot" href={`#matrix/${a.coin.mint}`}>
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
