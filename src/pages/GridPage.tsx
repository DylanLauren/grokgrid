import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MAIN_TICKER } from '../config'
import type { AgentsFeed } from '../data/types'
import { BODY, EYES, FAMILY } from '../ui/BotMark'
import { LiveBot, type Habit } from '../ui/LiveBot'
import { Roll } from '../ui/Roll'
import { Page, Section } from './Page'

// What each one of the family does while it waits, and what it says when you point at it.
const CAST: { habit: Habit; say: string }[] = [
  { habit: 'look', say: 'i watch the whales' },
  { habit: 'bounce', say: 'pick me pick me' },
  { habit: 'float', say: 'i only buy dips' },
  { habit: 'sway', say: 'steady hands' },
  { habit: 'tilt', say: 'hmm, that chart' },
  { habit: 'flip', say: 'full send' },
  { habit: 'hop', say: 'up only' },
  { habit: 'squish', say: 'i hold forever' },
  { habit: 'doze', say: 'wake me at 2x' },
]

// Everything pump.fun asks for when a coin is created, plus how the bot should trade.
interface Draft {
  look: number
  name: string
  ticker: string
  description: string
  website: string
  x: string
  telegram: string
  strategy: string
  maxSol: string
  takeProfit: string
  stopLoss: string
  firstBuy: string
}

const EMPTY: Draft = { look: 3, name: '', ticker: '', description: '', website: '', x: '', telegram: '', strategy: '', maxSol: '0.25', takeProfit: '100', stopLoss: '30', firstBuy: '' }
const DRAFT_KEY = 'gg-launch-draft'
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
  if (d.website && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(d.website)) e.website = 'a full https:// link'
  if (d.x && !/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/status\/\d+)?\/?$/.test(d.x)) e.x = 'an x.com link to a profile or post'
  if (d.telegram && !/^https:\/\/t\.me\/[A-Za-z0-9_+]{3,}\/?$/.test(d.telegram)) e.telegram = 'a t.me link'
  if (!d.strategy.trim()) e.strategy = 'one line on how it trades'
  const n = (v: string, lo: number, hi: number) => v !== '' && !(Number(v) >= lo && Number(v) <= hi)
  if (n(d.maxSol, 0.01, 10)) e.maxSol = '0.01 to 10 SOL'
  if (n(d.takeProfit, 5, 10000)) e.takeProfit = '5% to 10,000%'
  if (n(d.stopLoss, 1, 95)) e.stopLoss = '1% to 95%'
  if (n(d.firstBuy, 0, 50)) e.firstBuy = '0 to 50 SOL'
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
  const [imgErr, setImgErr] = useState('')
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({})
  const [cheer, setCheer] = useState(0)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const touch = (k: keyof Draft) => setTouched((t) => ({ ...t, [k]: true }))

  const look = FAMILY[d.look]
  const errs = check(d)
  const botPic = useMemo(() => botImage(d.look), [d.look])
  const pic = image?.url ?? botPic
  const ready = false // the launch flow opens after the main coin is live
  const userBots = grid.mode === 'live' ? grid.agents.filter((a) => !a.house).length : 0
  const err = (k: keyof Draft) => (touched[k] ? errs[k] : undefined)

  return (
    <Page say="make me a sibling" n={5} label="the grid" title="Launch a bot" sub={`every bot is its own coin on pump.fun. 80% of its fees fund its trades, 20% buy and burn $${MAIN_TICKER}. pick one of the family to start.`}>
      <div className="gd-line" role="radiogroup" aria-label="pick a bot">
        {FAMILY.map((f, i) => (
          <button
            key={f.name}
            role="radio"
            aria-checked={i === d.look}
            className={`gd-pick ${i === d.look ? 'on' : ''}`}
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
              {d.website && <span>web</span>}
              {d.x && <span>x</span>}
              {d.telegram && <span>telegram</span>}
              <span className="dim">launched on grokgrid</span>
            </div>
          </div>
        </div>

        <form className="card gd-form" onSubmit={(e) => e.preventDefault()} noValidate>
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
                      if (!f) return
                      if (f.size > IMAGE_MAX) return setImgErr('4 MB at most')
                      setImgErr('')
                      if (image) URL.revokeObjectURL(image.url)
                      setImage({ url: URL.createObjectURL(f), name: f.name })
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

          <Group n="02" title="links" note="optional">
            <Field label="website" error={err('website')}>
              <input inputMode="url" value={d.website} placeholder="https://" onBlur={() => touch('website')} onChange={(e) => set('website', e.target.value.trim())} />
            </Field>
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
              <Field label="max per trade" unit="SOL" error={err('maxSol')}>
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
            <Field label="first buy" unit="SOL" error={err('firstBuy')} hint="optional. you buy your own coin in the same transaction, before anyone else can.">
              <input inputMode="decimal" value={d.firstBuy} placeholder="0" onBlur={() => touch('firstBuy')} onChange={(e) => set('firstBuy', num(e.target.value))} />
            </Field>
            <div className="gd-split">
              <div>
                <b>80%</b>
                <span>of its creator fees go to its own trading wallet</span>
              </div>
              <div>
                <b>20%</b>
                <span>buy ${MAIN_TICKER} on the market and burn it</span>
              </div>
            </div>
            <p className="gd-note mono">paired with SOL on pump.fun · fee split locked at creation · you pay network fees and pump.fun rent only</p>
            <button className="btn" disabled={!ready}>
              <Roll>Launch bot</Roll>
            </button>
            <p className="gd-note">
              {ready
                ? 'one wallet approval. the coin, the bot and the fee split go live together.'
                : `launching opens once $${MAIN_TICKER} is live. your draft stays saved in this tab, except the image.`}
            </p>
          </Group>
        </form>
      </div>

      <Section title="On the grid" note={`${userBots} launched`}>
        <div className="card gd-empty">
          <LiveBot color="#0b0b0b" shape="sphere" habit="doze" size={44} />
          <span>no user bots yet. the first ones line up in the matrix, ranked by profit.</span>
        </div>
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
  const eyes = EYES.map(([cx, cy]) => `<rect x="${cx - 5.5}" y="${cy - 12.5}" width="11" height="25" rx="5.5" fill="#fff" transform="rotate(-27 ${cx} ${cy})"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -14 128 128"><rect x="-14" y="-14" width="128" height="128" fill="#f2f3f5"/><path d="${BODY[f.shape]}" fill="${f.color}"/>${eyes}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
