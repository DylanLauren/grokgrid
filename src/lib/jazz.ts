// The room's music: a late-night jazz trio, improvised live in the browser. The piano is
// the Salamander Grand (real recorded piano notes), the bass is a recorded fingered bass
// played dark and short like an upright, and the brushes are shaped noise. The notes are
// written on the spot: a 16 bar form of ii V turnarounds in F, rootless left hand voicings,
// a walking bass with chromatic approach notes, and a right hand that plays short swung
// phrases from each chord's scale and leaves space between them. It never loops the same.
//
// Browsers only let sound start from a click, so it starts from the loading screen's
// Enter button (or the speaker button in the bar). The on/off choice is remembered.
// Sample credits: public/audio/jazz/CREDITS.txt.

const KEY = 'gg-sound'
const BPM = 84
const BEAT = 60 / BPM
const BAR = BEAT * 4
const SWING = 0.64 // where the off-beat eighth lands inside the beat
const VOLUME = 0.55
const BASE = '/audio/jazz/'

// recorded notes we have, by midi number; every other note is the nearest one retuned
const PIANO: Record<number, string> = {
  33: 'A1', 36: 'C2', 39: 'Ds2', 42: 'Fs2', 45: 'A2', 48: 'C3', 51: 'Ds3', 54: 'Fs3', 57: 'A3',
  60: 'C4', 63: 'Ds4', 66: 'Fs4', 69: 'A4', 72: 'C5', 75: 'Ds5', 78: 'Fs5', 81: 'A5', 84: 'C6',
}
const BASS: Record<number, string> = { 28: 'E1', 31: 'G1', 34: 'As1', 37: 'Cs2', 40: 'E2', 43: 'G2', 46: 'As2', 49: 'Cs3', 52: 'E3' }

// ---------- the tune ----------
type Q = 'maj7' | 'm7' | '7' | '7b9' | 'm7b5' | 'm6' | 'dim7' | '9'
interface Quality { tones: number[]; scale: number[]; a: number[]; b: number[] }
const QUAL: Record<Q, Quality> = {
  maj7: { tones: [0, 4, 7, 11], scale: [0, 2, 4, 7, 9, 11], a: [4, 7, 11, 14], b: [11, 14, 16, 19] },
  m7: { tones: [0, 3, 7, 10], scale: [0, 2, 3, 5, 7, 9, 10], a: [3, 7, 10, 14], b: [10, 14, 15, 19] },
  '7': { tones: [0, 4, 7, 10], scale: [0, 2, 4, 7, 9, 10], a: [4, 9, 10, 14], b: [10, 14, 16, 21] },
  '9': { tones: [0, 4, 7, 10], scale: [0, 2, 4, 5, 7, 9, 10], a: [4, 7, 10, 14], b: [10, 14, 16, 19] },
  '7b9': { tones: [0, 4, 7, 10], scale: [0, 1, 3, 4, 7, 8, 10], a: [4, 8, 10, 13], b: [10, 13, 16, 20] },
  m7b5: { tones: [0, 3, 6, 10], scale: [0, 3, 5, 6, 8, 10], a: [3, 6, 10, 14], b: [10, 14, 15, 18] },
  m6: { tones: [0, 3, 7, 9], scale: [0, 2, 3, 5, 7, 9, 11], a: [3, 7, 9, 14], b: [9, 14, 15, 19] },
  dim7: { tones: [0, 3, 6, 9], scale: [0, 2, 3, 5, 6, 8, 9, 11], a: [3, 6, 9, 12], b: [6, 9, 12, 15] },
}
interface Chord { pc: number; q: Q }
const c = (pc: number, q: Q): Chord => ({ pc, q })
const F = 5, D = 2, G = 7, C = 0, A = 9, Bb = 10, Ab = 8, E = 4
// one or two chords per bar
const FORM: Chord[][] = [
  [c(F, 'maj7')], [c(D, '7b9')], [c(G, 'm7')], [c(C, '7')],
  [c(A, 'm7')], [c(D, '7b9')], [c(G, 'm7')], [c(C, '9')],
  [c(F, 'maj7')], [c(F, '7')], [c(Bb, 'maj7')], [c(Bb, 'm6')],
  [c(A, 'm7')], [c(Ab, 'dim7')], [c(G, 'm7'), c(C, '7')], [c(F, 'maj7'), c(E, 'm7b5')],
]

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const chance = (p: number) => Math.random() < p
const human = (ms = 12) => ((Math.random() - 0.5) * 2 * ms) / 1000
const near = (pc: number, to: number) => {
  let m = pc + 12 * Math.round((to - pc) / 12)
  if (m - to > 6) m -= 12
  if (to - m > 6) m += 12
  return m
}

// ---------- state ----------
let ctx: AudioContext | null = null
let out: GainNode, room: GainNode, pianoBus: GainNode, bassBus: GainNode, kitBus: GainNode
let noise: AudioBuffer
const buffers = { piano: new Map<number, AudioBuffer>(), bass: new Map<number, AudioBuffer>() }
let fetched: Promise<Record<string, ArrayBuffer>> | null = null
let ready = false
let timer = 0
let nextBar = 0
let bar = 0
let playing = false
// what the band remembers from bar to bar
let lhLow = 53, bassNote = 41, melNote = 72, phraseLeft = 0, rest = 1
const subs = new Set<() => void>()

export function soundPref() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}
export const isPlaying = () => playing
export function onSound(f: () => void) {
  subs.add(f)
  return () => void subs.delete(f)
}
const emit = () => subs.forEach((f) => f())

/** Start downloading the recorded notes (about 1.8 MB) before anyone presses Enter. */
export function preloadJazz() {
  if (fetched) return fetched
  const files = [...Object.values(PIANO).map((n) => `piano-${n}`), ...Object.values(BASS).map((n) => `bass-${n}`)]
  fetched = Promise.all(files.map(async (f) => [f, await (await fetch(`${BASE}${f}.mp3`)).arrayBuffer()] as const))
    .then((all) => Object.fromEntries(all))
    .catch((e) => {
      fetched = null
      throw e
    })
  return fetched
}

/** Turn the music on or off and remember it. Call from a click. */
export function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* private window */
  }
  if (on) startJazz()
  else stopJazz()
}

/** Start playing, softly fading in once the notes are loaded. Call from a click. */
export function startJazz() {
  if (playing) return
  if (!ctx && !build()) return
  void ctx!.resume()
  playing = true
  emit()
  void load().then((ok) => {
    if (!ok || !playing || !ctx) return
    const t = ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(out.gain.value, t)
    out.gain.linearRampToValueAtTime(VOLUME, t + 2.5)
    nextBar = Math.max(nextBar, t + 0.15)
    clearInterval(timer)
    timer = window.setInterval(schedule, 100)
    schedule()
  })
}

export function stopJazz() {
  if (!ctx || !playing) return
  playing = false
  const a = ctx, t = a.currentTime
  out.gain.cancelScheduledValues(t)
  out.gain.setValueAtTime(out.gain.value, t)
  out.gain.linearRampToValueAtTime(0, t + 0.8)
  clearInterval(timer)
  setTimeout(() => !playing && void a.suspend(), 900)
  emit()
}

async function load() {
  if (ready) return true
  try {
    const raw = await preloadJazz()
    const a = ctx!
    await Promise.all(
      Object.entries(raw).map(async ([name, data]) => {
        const buf = await a.decodeAudioData(data.slice(0))
        const [kind, note] = name.split('-') as ['piano' | 'bass', string]
        const table = kind === 'piano' ? PIANO : BASS
        const midi = Number(Object.keys(table).find((k) => table[Number(k)] === note))
        buffers[kind].set(midi, buf)
      }),
    )
    ready = true
    return true
  } catch {
    return false
  }
}

function build() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return false
  const a = (ctx = new AC())
  out = a.createGain()
  out.gain.value = 0
  const glue = a.createDynamicsCompressor()
  glue.threshold.value = -18
  glue.ratio.value = 2.5
  glue.attack.value = 0.015
  glue.release.value = 0.25
  // a touch of tape: the very top rolled off
  const tape = a.createBiquadFilter()
  tape.type = 'lowpass'
  tape.frequency.value = 9000
  out.connect(tape).connect(glue).connect(a.destination)

  // a small, warm club room
  const verb = a.createConvolver()
  verb.buffer = impulse(a, 1.9)
  const verbTone = a.createBiquadFilter()
  verbTone.type = 'lowpass'
  verbTone.frequency.value = 4200
  room = a.createGain()
  room.gain.value = 1
  room.connect(verb).connect(verbTone).connect(out)

  pianoBus = bus(a, 0.9, 0.22, -0.12)
  bassBus = bus(a, 1.05, 0.08, 0.05)
  kitBus = bus(a, 0.55, 0.18, 0.22)

  noise = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

  // a hidden tab goes quiet and picks the tune back up when it comes back
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !playing) return
    if (document.hidden) void ctx.suspend()
    else {
      void ctx.resume()
      nextBar = Math.max(nextBar, ctx.currentTime + 0.15)
    }
  })
  return true
}

// a line into the mix, placed left or right, with some of it sent to the room
function bus(a: AudioContext, level: number, wet: number, pan: number) {
  const g = a.createGain()
  g.gain.value = level
  const p = a.createStereoPanner()
  p.pan.value = pan
  g.connect(p).connect(out)
  const send = a.createGain()
  send.gain.value = wet
  g.connect(send).connect(room)
  return g
}

function impulse(a: AudioContext, secs: number) {
  const len = Math.floor(a.sampleRate * secs)
  const b = a.createBuffer(2, len, a.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      // a few early reflections, then a smooth tail
      const early = i < a.sampleRate * 0.08 && Math.random() < 0.002 ? 0.6 : 0
      d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - i / len, 4) + early) * 0.9
    }
  }
  return b
}

function schedule() {
  if (!ctx || !playing) return
  while (nextBar < ctx.currentTime + 0.5) {
    playBar(nextBar, bar)
    nextBar += BAR
    bar++
  }
}

// eighth k of the bar (0..7), swung
const at = (t0: number, k: number) => t0 + (Math.floor(k / 2) + (k % 2 ? SWING : 0)) * BEAT

function playBar(t0: number, n: number) {
  const chords = FORM[n % FORM.length]
  const nextChord = FORM[(n + 1) % FORM.length][0]
  const chorus = Math.floor(n / FORM.length)
  const beatsEach = 4 / chords.length

  chords.forEach((ch, i) => {
    const start = t0 + i * beatsEach * BEAT
    const following = chords[i + 1] ?? nextChord
    walk(ch, following, start, beatsEach, chorus === 0 && n % FORM.length < 8)
    comp(ch, start, beatsEach, i)
  })
  melody(chords, t0, n)
  drums(t0, chorus)
}

// ---------- bass ----------
function walk(ch: Chord, next: Chord, t: number, beats: number, twoFeel: boolean) {
  const root = near(ch.pc, bassNote)
  const r = root < 29 ? root + 12 : root > 45 ? root - 12 : root
  const target = near(next.pc, r)
  const q = QUAL[ch.q]
  const notes: number[] = [r]
  if (twoFeel && beats === 4) {
    // the first half of the first chorus lopes along in two
    const fifth = r + 7 > 47 ? r - 5 : r + 7
    note('bass', r, t + human(6), BEAT * 1.9, 0.82)
    note('bass', fifth, t + 2 * BEAT + human(6), BEAT * 1.9, 0.74)
    bassNote = fifth
    return
  }
  // step through chord and scale tones toward the next root, then lean into it by a half step
  for (let b = 1; b < beats - 1; b++) {
    const prev = notes[b - 1]
    const dir = target > prev ? 1 : -1
    const pool = (b % 2 ? q.scale : q.tones).flatMap((x) => [r + x - 12, r + x, r + x + 12]).filter((m) => m >= 28 && m <= 50 && m !== prev)
    const ahead = pool.filter((m) => (m - prev) * dir > 0 && Math.abs(m - prev) <= 5)
    notes.push(ahead.length ? pick(ahead) : pool.reduce((x, y) => (Math.abs(y - prev) < Math.abs(x - prev) ? y : x)))
  }
  if (beats > 1) {
    const last = notes[notes.length - 1]
    notes.push(chance(0.75) ? target + (last > target ? 1 : -1) : target + 7 > 50 ? target - 5 : target + 7)
  }
  notes.forEach((m, b) => note('bass', m, t + b * BEAT + human(6), BEAT * 0.92, b === 0 ? 0.86 : 0.74 + Math.random() * 0.08))
  bassNote = notes[notes.length - 1]
}

// ---------- piano, left hand ----------
// rootless voicings that move as little as they can from one chord to the next
function voicing(ch: Chord) {
  const q = QUAL[ch.q]
  const options = [q.a, q.b].flatMap((shape) => [-12, 0, 12].map((o) => shape.map((x) => ch.pc + 48 + o + x)))
  const fit = options.filter((v) => v[0] >= 50 && v[0] <= 60)
  const best = (fit.length ? fit : options).reduce((x, y) => (Math.abs(y[0] - lhLow) < Math.abs(x[0] - lhLow) ? y : x))
  lhLow = best[0]
  return best
}

const COMPS = [[0], [3], [0, 3], [1, 5], [3, 6], [0, 5], [2, 7], [5]]
function comp(ch: Chord, t: number, beats: number, i: number) {
  const v = voicing(ch)
  const hits = beats === 4 ? pick(COMPS) : chance(0.6) ? [0] : [1]
  hits.forEach((k, j) => {
    const when = at(t, k) + human(10)
    // the Charleston stab is short; the last hit of the bar can ring a little
    const len = j === hits.length - 1 && chance(0.5) ? BEAT * 1.4 : BEAT * (0.35 + Math.random() * 0.25)
    const vel = 0.36 + Math.random() * 0.1 + (i === 0 && k === 0 ? 0.04 : 0)
    // a pianist's hand never lands all at once
    v.forEach((m, x) => note('piano', m, when + x * 0.006, len, vel - x * 0.015))
  })
}

// ---------- piano, right hand ----------
function melody(chords: Chord[], t0: number, n: number) {
  // phrases of one or two bars, then a breath
  if (phraseLeft <= 0) {
    if (rest > 0) {
      rest--
      return
    }
    phraseLeft = chance(0.55) ? 2 : 1
  }
  phraseLeft--
  const endsHere = phraseLeft === 0
  // the rhythm: mostly swung eighths, some quarters, a late start now and then
  let k = n % 4 === 0 ? 0 : pick([0, 1, 2, 3])
  while (k < 8) {
    const ch = chords[chords.length === 2 && k >= 4 ? 1 : 0]
    const q = QUAL[ch.q]
    const strong = k % 2 === 0
    const last = endsHere && k >= 5
    // chord tones on the beat, scale tones in between, moving by step
    const set = (strong || last ? [...q.tones, ...(ch.q === 'maj7' || ch.q === 'm7' ? [14] : [])] : q.scale).flatMap((x) => [48, 60, 72, 84].map((o) => ch.pc + o + x)).filter((m) => m >= 64 && m <= 86)
    const around = set.filter((m) => m !== melNote && Math.abs(m - melNote) <= (strong ? 5 : 3))
    const m = around.length ? pick(around) : set.reduce((x, y) => (Math.abs(y - melNote) < Math.abs(x - melNote) ? y : x))
    const len = last ? BEAT * (1.5 + Math.random()) : chance(0.2) ? BEAT : BEAT * 0.5
    // off-beats leaned on a little, the way swing is played; the odd note ghosted
    const vel = (strong ? 0.48 : 0.56) + Math.random() * 0.08 - (chance(0.12) ? 0.2 : 0)
    note('piano', m, at(t0, k) + human(14), len * 0.95, vel)
    melNote = m
    if (last) break
    k += len >= BEAT ? 2 : 1
  }
  if (endsHere) {
    rest = pick([1, 1, 2])
    // drift back toward the middle of the keyboard for the next idea
    if (melNote > 80) melNote -= 5
    if (melNote < 66) melNote += 5
  }
}

// ---------- the recorded notes ----------
function note(kind: 'piano' | 'bass', m: number, t: number, len: number, vel: number) {
  const a = ctx!
  const table = buffers[kind]
  if (!table.size) return
  let src = 0, best = Infinity
  for (const k of table.keys()) if (Math.abs(k - m) < best) (best = Math.abs(k - m)), (src = k)
  const s = a.createBufferSource()
  s.buffer = table.get(src)!
  s.playbackRate.value = Math.pow(2, (m - src) / 12)
  // softer notes are darker, like a real hammer or finger
  const tone = a.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = kind === 'bass' ? 800 + vel * 600 : 2600 + vel * 9000
  tone.Q.value = 0.5
  const g = a.createGain()
  const level = Math.max(0.02, vel) ** 1.6 * (kind === 'bass' ? 1.5 : 0.9)
  const release = kind === 'bass' ? 0.07 : 0.32
  const end = t + Math.max(0.05, len)
  g.gain.setValueAtTime(level, t)
  g.gain.setValueAtTime(level, end)
  g.gain.exponentialRampToValueAtTime(0.0001, end + release)
  s.connect(tone).connect(g).connect(kind === 'bass' ? bassBus : pianoBus)
  s.start(Math.max(t, a.currentTime))
  s.stop(end + release + 0.02)
}

// ---------- brushes ----------
function hiss(t: number, len: number) {
  const s = ctx!.createBufferSource()
  s.buffer = noise
  s.start(t, Math.random() * 1.5)
  s.stop(t + len)
  return s
}

function drums(t0: number, chorus: number) {
  for (let b = 0; b < 4; b++) {
    const t = t0 + b * BEAT
    // the left hand stirs circles on the snare the whole time
    swish(t, BEAT, 0.045 + (b % 2 ? 0.012 : 0))
    // the right hand pats two and four, with the swung skip before them
    if (b % 2 === 1) {
      tap(t + human(5), 0.09)
      if (chance(0.7)) tap(at(t0, b * 2 - 1) + human(5), 0.03)
      chick(t + human(4), 0.06)
    }
  }
  // a light ride from the second chorus on
  if (chorus > 0) for (const k of [0, 2, 3, 4, 6, 7]) if (k % 2 === 0 || chance(0.85)) ride(at(t0, k) + human(5), k % 2 ? 0.025 : 0.04)
  // a feathered kick under one, now and then
  if (chance(0.5)) kick(t0 + human(5), 0.07)
}

function swish(t: number, len: number, v: number) {
  const a = ctx!
  const bp = a.createBiquadFilter(), g = a.createGain()
  bp.type = 'bandpass'
  bp.Q.value = 0.7
  bp.frequency.setValueAtTime(2600, t)
  bp.frequency.linearRampToValueAtTime(4200, t + len * 0.6)
  bp.frequency.linearRampToValueAtTime(3000, t + len)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(v, t + len * 0.45)
  g.gain.linearRampToValueAtTime(0.0001, t + len)
  hiss(t, len + 0.02).connect(bp).connect(g).connect(kitBus)
}

function tap(t: number, v: number) {
  const a = ctx!
  const bp = a.createBiquadFilter(), g = a.createGain()
  bp.type = 'bandpass'
  bp.frequency.value = 1900
  bp.Q.value = 0.9
  g.gain.setValueAtTime(v, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  hiss(t, 0.2).connect(bp).connect(g).connect(kitBus)
}

function chick(t: number, v: number) {
  const a = ctx!
  const hp = a.createBiquadFilter(), g = a.createGain()
  hp.type = 'highpass'
  hp.frequency.value = 7000
  g.gain.setValueAtTime(v, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  hiss(t, 0.06).connect(hp).connect(g).connect(kitBus)
}

function ride(t: number, v: number) {
  const a = ctx!
  const hp = a.createBiquadFilter(), bp = a.createBiquadFilter(), g = a.createGain()
  hp.type = 'highpass'
  hp.frequency.value = 6000
  bp.type = 'peaking'
  bp.frequency.value = 9500
  bp.gain.value = 6
  g.gain.setValueAtTime(v, t)
  g.gain.exponentialRampToValueAtTime(v * 0.25, t + 0.06)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
  hiss(t, 0.75).connect(hp).connect(bp).connect(g).connect(kitBus)
}

function kick(t: number, v: number) {
  const a = ctx!
  const o = a.createOscillator(), g = a.createGain()
  o.frequency.setValueAtTime(65, t)
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
  g.gain.setValueAtTime(v, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
  o.connect(g).connect(kitBus)
  o.start(t)
  o.stop(t + 0.3)
}
