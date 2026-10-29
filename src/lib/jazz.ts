// The room's music: a slow, soft jazz trio played live by Web Audio. No samples and no
// recordings. Rhodes chords, a walking upright bass, brushes and a ride cymbal, all
// synthesised here, over an eight bar ii V I loop at 72 bpm with a lazy swing. Every bar
// is improvised fresh, so it never repeats exactly.
//
// Browsers only let sound start from a click, so it starts from the loading screen's
// Enter button (or the speaker button in the bar). The on/off choice is remembered.

const KEY = 'gg-sound'
const BPM = 72
const BEAT = 60 / BPM
const BAR = BEAT * 4
const SWING = 0.64 // where the off-beat eighth lands inside the beat
const VOLUME = 0.42

// one bar each: bass root (midi), the quality of its third and seventh, the Rhodes voicing
interface Chord { root: number; third: number; fifth: number; voicing: number[]; tones: number[] }
const C = (root: number, third: number, fifth: number, voicing: number[], tones: number[]): Chord => ({ root, third, fifth, voicing, tones })
const CHORDS: Chord[] = [
  C(38, 3, 7, [53, 57, 60, 64], [62, 65, 69, 72, 76]), // Dm9
  C(43, 4, 7, [53, 59, 64, 69], [67, 71, 74, 76, 79]), // G13
  C(36, 4, 7, [52, 55, 59, 62], [64, 67, 71, 74, 76]), // Cmaj9
  C(45, 4, 7, [55, 61, 65, 70], [69, 73, 76, 77, 79]), // A7b9b13
  C(41, 4, 7, [57, 60, 64, 67], [65, 69, 72, 76, 79]), // Fmaj9
  C(46, 4, 7, [56, 60, 62, 67], [65, 70, 72, 74, 77]), // Bb9
  C(40, 3, 7, [55, 59, 62, 66], [64, 67, 71, 74, 78]), // Em9
  C(45, 4, 7, [55, 61, 65, 70], [69, 72, 73, 76, 77]), // A7alt
]
// where in the bar the piano comps, in eighths (0 is beat one, 1 its swung off-beat)
const COMPS = [[0], [0, 5], [1, 5], [0, 3], [3, 7], [0, 6], [1]]

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const human = () => (Math.random() - 0.5) * 0.016

let ctx: AudioContext | null = null
let out: GainNode, keys: GainNode, bass: GainNode, kit: GainNode, verb: GainNode
let noise: AudioBuffer
let timer = 0
let nextBar = 0
let bar = 0
let playing = false
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

/** Start playing, softly fading in. Call from a click so the browser allows it. */
export function startJazz() {
  if (playing) return
  if (!ctx && !build()) return
  const a = ctx!
  void a.resume()
  playing = true
  const t = a.currentTime
  out.gain.cancelScheduledValues(t)
  out.gain.setValueAtTime(out.gain.value, t)
  out.gain.linearRampToValueAtTime(VOLUME, t + 3.5)
  nextBar = Math.max(nextBar, t + 0.12)
  clearInterval(timer)
  timer = window.setInterval(schedule, 120)
  schedule()
  emit()
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

function build() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return false
  const a = (ctx = new AC())
  out = a.createGain()
  out.gain.value = 0
  // warm the top off and keep the peaks soft
  const tone = a.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 5200
  tone.Q.value = 0.4
  const glue = a.createDynamicsCompressor()
  glue.threshold.value = -20
  glue.ratio.value = 3
  glue.attack.value = 0.02
  glue.release.value = 0.3
  out.connect(tone).connect(glue).connect(a.destination)

  // a small dark room
  const room = a.createConvolver()
  room.buffer = impulse(a, 2.8)
  verb = a.createGain()
  verb.gain.value = 0.32
  verb.connect(room).connect(out)

  // the Rhodes drifts gently from side to side
  const pan = a.createStereoPanner()
  const lfo = a.createOscillator(), depth = a.createGain()
  lfo.frequency.value = 0.18
  depth.gain.value = 0.28
  lfo.connect(depth).connect(pan.pan)
  lfo.start()
  keys = a.createGain()
  keys.gain.value = 0.5
  keys.connect(pan)
  bus(a, pan, 0.55)
  bass = bus(a, a.createGain(), 0.12, 0.75)
  kit = bus(a, a.createGain(), 0.25, 0.35)

  noise = a.createBuffer(1, a.sampleRate * 2, a.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

  // a hidden tab goes quiet and picks the tune back up when it comes back
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !playing) return
    if (document.hidden) void ctx.suspend()
    else {
      void ctx.resume()
      nextBar = Math.max(nextBar, ctx.currentTime + 0.12)
    }
  })
  return true
}

// a line into the mix, with some of it sent to the room
function bus<N extends AudioNode>(a: AudioContext, g: N, wet: number, level?: number) {
  if (level !== undefined && g instanceof GainNode) g.gain.value = level
  g.connect(out)
  const send = a.createGain()
  send.gain.value = wet
  g.connect(send).connect(verb)
  return g
}

function impulse(a: AudioContext, secs: number) {
  const len = Math.floor(a.sampleRate * secs)
  const b = a.createBuffer(2, len, a.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
  }
  return b
}

function schedule() {
  if (!ctx || !playing) return
  while (nextBar < ctx.currentTime + 0.6) {
    playBar(nextBar, bar)
    nextBar += BAR
    bar++
  }
}

// eighth k of the bar, swung
const at = (t0: number, k: number) => t0 + (Math.floor(k / 2) + (k % 2 ? SWING : 0)) * BEAT

function playBar(t0: number, n: number) {
  const ch = CHORDS[n % CHORDS.length]
  const next = CHORDS[(n + 1) % CHORDS.length]

  // piano: a couple of soft stabs, held to the next one
  const hits = n % 8 === 0 ? [0] : pick(COMPS)
  hits.forEach((k, i) => {
    const end = i + 1 < hits.length ? at(t0, hits[i + 1]) : t0 + BAR + (k > 4 ? BEAT * 0.5 : 0)
    const v = 0.06 + Math.random() * 0.03
    const spread = Math.random() < 0.5 ? 0.012 : 0 // sometimes rolled
    ch.voicing.forEach((m, j) => rhodes(hz(m), at(t0, k) + human() + j * spread, end - at(t0, k), v))
  })

  // bass: root, chord tones, then a step into the next root
  const r = ch.root
  let target = next.root
  while (target - r > 6) target -= 12
  while (r - target > 6) target += 12
  const walk = [r, r + pick([ch.third, ch.fifth, 12]), r + pick([ch.fifth, ch.third + 12, 10]), target + pick([-1, 1, -2])]
  walk.forEach((m, b) => upright(hz(m), t0 + b * BEAT + human(), b === 0 ? 0.95 : 0.8))

  // a few sparse vibe notes every other bar, never busy
  if (n % 2 === 1 && Math.random() < 0.8) {
    const count = 2 + Math.floor(Math.random() * 3)
    let k = pick([0, 1, 2])
    for (let i = 0; i < count && k < 8; i++) {
      vibe(hz(pick(ch.tones)), at(t0, k) + human(), 0.035 + Math.random() * 0.02)
      k += pick([1, 2, 3])
    }
  }

  // ride: ding, ding-a ding
  for (let b = 0; b < 4; b++) {
    ride(t0 + b * BEAT + human(), b % 2 ? 0.05 : 0.035)
    if (b % 2 === 1) ride(at(t0, b * 2 + 1) + human(), 0.022)
  }
  // brushes: a swirl through every beat, a tap on two and four
  for (let b = 0; b < 4; b++) brush(t0 + b * BEAT, BEAT, b % 2 ? 0.03 : 0.018, b % 2 === 1)
  // a feathered kick under one
  kick(t0 + human(), 0.12)
}

function rhodes(f: number, t: number, len: number, v: number) {
  const a = ctx!
  const car = a.createOscillator(), mod = a.createOscillator(), modAmp = a.createGain()
  const tine = a.createOscillator(), tineAmp = a.createGain()
  const amp = a.createGain()
  car.frequency.value = f
  mod.frequency.value = f
  tine.frequency.value = f * 7.02
  // the bark: brighter as it is struck, mellowing as it rings
  modAmp.gain.setValueAtTime(f * 1.4, t)
  modAmp.gain.exponentialRampToValueAtTime(f * 0.18, t + 0.7)
  tineAmp.gain.setValueAtTime(v * 0.18, t)
  tineAmp.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
  const stop = t + Math.min(len, 3.6) + 0.5
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(v, t + 0.006)
  amp.gain.exponentialRampToValueAtTime(v * 0.35, t + 1.2)
  amp.gain.setValueAtTime(v * 0.35, t + Math.max(0.02, Math.min(len, 3.6) - 0.01))
  amp.gain.exponentialRampToValueAtTime(0.0001, stop)
  mod.connect(modAmp).connect(car.frequency)
  car.connect(amp)
  tine.connect(tineAmp).connect(amp)
  amp.connect(keys)
  for (const o of [car, mod, tine]) {
    o.start(t)
    o.stop(stop + 0.05)
  }
}

function upright(f: number, t: number, v: number) {
  const a = ctx!
  const o = a.createOscillator(), o2 = a.createOscillator(), lp = a.createBiquadFilter(), amp = a.createGain()
  o.type = 'triangle'
  o.frequency.value = f
  o2.frequency.value = f
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, t)
  lp.frequency.exponentialRampToValueAtTime(260, t + 0.25)
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(v * 0.5, t + 0.012)
  amp.gain.exponentialRampToValueAtTime(v * 0.18, t + 0.3)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 0.98)
  o.connect(lp)
  o2.connect(lp)
  lp.connect(amp).connect(bass)
  for (const x of [o, o2]) {
    x.start(t)
    x.stop(t + BEAT)
  }
}

function vibe(f: number, t: number, v: number) {
  const a = ctx!
  const o = a.createOscillator(), o2 = a.createOscillator(), amp = a.createGain(), amp2 = a.createGain()
  o.frequency.value = f
  o2.frequency.value = f * 4
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(v, t + 0.004)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 2.4)
  amp2.gain.setValueAtTime(v * 0.25, t)
  amp2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  o.connect(amp).connect(keys)
  o2.connect(amp2).connect(keys)
  for (const x of [o, o2]) {
    x.start(t)
    x.stop(t + 2.5)
  }
}

function hiss(t: number, len: number) {
  const s = ctx!.createBufferSource()
  s.buffer = noise
  s.start(t, Math.random() * 1.5)
  s.stop(t + len)
  return s
}

function ride(t: number, v: number) {
  const a = ctx!
  const hp = a.createBiquadFilter(), bp = a.createBiquadFilter(), amp = a.createGain()
  hp.type = 'highpass'
  hp.frequency.value = 6500
  bp.type = 'bandpass'
  bp.frequency.value = 9000
  bp.Q.value = 0.6
  amp.gain.setValueAtTime(v, t)
  amp.gain.exponentialRampToValueAtTime(v * 0.3, t + 0.08)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
  // a little metal under the hiss
  const bell = a.createOscillator(), bellAmp = a.createGain()
  bell.type = 'square'
  bell.frequency.value = 5130
  bellAmp.gain.setValueAtTime(v * 0.08, t)
  bellAmp.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
  bell.connect(bellAmp).connect(hp)
  hiss(t, 1).connect(hp)
  hp.connect(bp).connect(amp).connect(kit)
  bell.start(t)
  bell.stop(t + 0.4)
}

function brush(t: number, len: number, v: number, tap: boolean) {
  const a = ctx!
  const bp = a.createBiquadFilter(), amp = a.createGain()
  bp.type = 'bandpass'
  bp.Q.value = 0.8
  bp.frequency.setValueAtTime(2200, t)
  bp.frequency.linearRampToValueAtTime(3600, t + len)
  amp.gain.setValueAtTime(0.0001, t)
  if (tap) {
    amp.gain.linearRampToValueAtTime(v, t + 0.01)
    amp.gain.exponentialRampToValueAtTime(v * 0.25, t + 0.12)
  } else {
    amp.gain.linearRampToValueAtTime(v * 0.35, t + len * 0.5)
  }
  amp.gain.exponentialRampToValueAtTime(0.0001, t + len)
  hiss(t, len + 0.02).connect(bp).connect(amp).connect(kit)
}

function kick(t: number, v: number) {
  const a = ctx!
  const o = a.createOscillator(), amp = a.createGain()
  o.frequency.setValueAtTime(70, t)
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
  amp.gain.setValueAtTime(v, t)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  o.connect(amp).connect(kit)
  o.start(t)
  o.stop(t + 0.32)
}
