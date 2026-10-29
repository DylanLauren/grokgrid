// Shared sound kit for every cut: drums, 808, synth voices, a chopped vocal-style lead, UI sounds and the
// offline renderer. Each cut's track (tracks/<cut>.js, picked with ?cut=) calls setTempo() and defines
// music(seconds) and sfx(). Everything is synthesised with a fixed seed, so every render is identical.
// renderAudio(seconds) -> 16-bit stereo PCM at 48 kHz, as base64 for the encoder.
const SR = 48000
let BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4
function setTempo(bpm) { BPM = bpm; BEAT = 60 / bpm; BAR = BEAT * 4; S16 = BEAT / 4 }
let seed = 20261029
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

let ctx, out, room, echo, drumBus, musicBus, duck, sfxBus, noise, drive

function impulse(a, secs) {
  const len = Math.floor(a.sampleRate * secs)
  const b = a.createBuffer(2, len, a.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, 3.5) * 0.8
  }
  return b
}
function hiss(t, len) {
  const s = ctx.createBufferSource()
  s.buffer = noise
  s.start(t, rand() * 1.5)
  s.stop(t + len)
  return s
}
const env = (g, t, peak, a, d, floor = 0.0001) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(floor, t + a + d) }
function saturator(a, k) {
  const ws = a.createWaveShaper(), n = 1024, c = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k) }
  ws.curve = c
  return ws
}

// ---------- drums ----------
function kick(t, v = 1) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.07)
  g.gain.setValueAtTime(v, t); g.gain.setValueAtTime(v, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  o.connect(g).connect(drive); o.start(t); o.stop(t + 0.32)
  const hp = ctx.createBiquadFilter(), cg = ctx.createGain()
  hp.type = 'highpass'; hp.frequency.value = 3000
  env(cg, t, 0.35 * v, 0.001, 0.01)
  hiss(t, 0.02).connect(hp).connect(cg).connect(drumBus)
  // the music ducks under every kick, so the beat pumps
  duck.gain.setValueAtTime(1, t - 0.005); duck.gain.linearRampToValueAtTime(0.35, t + 0.008); duck.gain.setTargetAtTime(1, t + 0.03, 0.07)
}
function snare(t, v = 0.6) {
  // a tight pop snare: tuned body + bright noise, layered with a clap
  const o = ctx.createOscillator(), og = ctx.createGain()
  o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.05)
  env(og, t, v * 0.6, 0.001, 0.09)
  o.connect(og).connect(drumBus); o.start(t); o.stop(t + 0.12)
  const hp = ctx.createBiquadFilter(), g = ctx.createGain()
  hp.type = 'highpass'; hp.frequency.value = 1800
  env(g, t, v * 0.75, 0.001, 0.16)
  hiss(t, 0.2).connect(hp).connect(g).connect(drumBus)
  clap(t + 0.004, v * 0.6)
  const s = ctx.createGain(); s.gain.value = 0.45; g.connect(s).connect(room)
}
function clap(t, v = 0.5) {
  const bp = ctx.createBiquadFilter(), g = ctx.createGain()
  bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1
  g.gain.setValueAtTime(0.0001, t)
  for (const d of [0, 0.009, 0.018]) { g.gain.setValueAtTime(v, t + d); g.gain.exponentialRampToValueAtTime(v * 0.15, t + d + 0.008) }
  g.gain.setValueAtTime(v * 0.8, t + 0.027); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  hiss(t, 0.2).connect(bp).connect(g).connect(drumBus)
  const s = ctx.createGain(); s.gain.value = 0.3; g.connect(s).connect(room)
}
function snap(t, v = 0.3) {
  const bp = ctx.createBiquadFilter(), g = ctx.createGain()
  bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2.5
  env(g, t, v, 0.001, 0.06)
  hiss(t, 0.08).connect(bp).connect(g).connect(drumBus)
  const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s).connect(room)
}
function hat(t, v = 0.1, open = false) {
  const hp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner()
  hp.type = 'highpass'; hp.frequency.value = open ? 7500 : 9000
  p.pan.value = 0.2
  env(g, t, v, 0.001, open ? 0.2 : 0.028)
  hiss(t, open ? 0.24 : 0.04).connect(hp).connect(g).connect(p).connect(drumBus)
}
function shaker(t, v = 0.05) {
  const bp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner()
  bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 1.4
  p.pan.value = -0.3
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
  hiss(t, 0.08).connect(bp).connect(g).connect(p).connect(drumBus)
}
function crash(t, v = 0.2) {
  const hp = ctx.createBiquadFilter(), g = ctx.createGain()
  hp.type = 'highpass'; hp.frequency.value = 5000
  env(g, t, v, 0.002, 1.6)
  hiss(t, 1.8).connect(hp).connect(g).connect(drumBus)
  const s = ctx.createGain(); s.gain.value = 0.4; g.connect(s).connect(room)
}
function riser(t0, t1, v = 0.14) {
  const bp = ctx.createBiquadFilter(), g = ctx.createGain()
  bp.type = 'bandpass'; bp.Q.value = 2
  bp.frequency.setValueAtTime(500, t0); bp.frequency.exponentialRampToValueAtTime(8000, t1)
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t1 - 0.03); g.gain.linearRampToValueAtTime(0.0001, t1)
  hiss(t0, t1 - t0 + 0.05).connect(bp).connect(g).connect(musicBus)
}
function roll(t0, t1, v0 = 0.12, v1 = 0.45) {
  // snare roll speeding up into a drop
  let t = t0
  while (t < t1 - 0.01) {
    const k = (t - t0) / (t1 - t0)
    snare(t, v0 + (v1 - v0) * k)
    t += k < 0.5 ? S16 * 2 : k < 0.8 ? S16 : S16 / 2
  }
}

// ---------- 808 and keys ----------
function bass808(m, t, len, glideFrom = null, v = 0.5) {
  if (t < 0) return
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = 'sine'
  if (glideFrom != null) { o.frequency.setValueAtTime(hz(glideFrom), t); o.frequency.exponentialRampToValueAtTime(hz(m), t + 0.09) }
  else o.frequency.setValueAtTime(hz(m), t)
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006)
  g.gain.setValueAtTime(v, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  o.connect(g).connect(drive); o.start(t); o.stop(t + len + 0.02)
}
function voice(m, t, len, { type = 'sawtooth', v = 0.1, cut = 2000, cutEnd = null, q = 1, a = 0.005, rel = 0.12, detune = [0], bus = musicBus, pan = 0, send = 0, verb = 0 }) {
  if (t < 0) return
  const f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner()
  f.type = 'lowpass'; f.Q.value = q
  f.frequency.setValueAtTime(cut, t)
  if (cutEnd) f.frequency.exponentialRampToValueAtTime(cutEnd, t + len)
  p.pan.value = pan
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a)
  g.gain.setValueAtTime(v, t + Math.max(a, len)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, len) + rel)
  f.connect(g).connect(p).connect(bus)
  if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(echo) }
  if (verb) { const s = ctx.createGain(); s.gain.value = verb; p.connect(s).connect(room) }
  for (const d of detune) {
    const o = ctx.createOscillator()
    o.type = type; o.frequency.value = hz(m); o.detune.value = d
    o.connect(f); o.start(t); o.stop(t + Math.max(a, len) + rel + 0.02)
  }
}
// bright electric-piano style keys: sine body + a soft bell partial, short and syncopated
// syncopated keys stabs: pattern is 16ths in the bar
function keys(ch, t, open, KEYS = [0, 3, 6, 10, 12]) {
  for (const k of KEYS) ch.slice(1).forEach((m, i) => {
    const at = t + k * S16 + i * 0.004
    voice(m, at, S16 * 1.3, { type: 'triangle', v: 0.05, cut: open ? 5000 : 1400, rel: 0.18, pan: [-0.3, -0.1, 0.1, 0.3][i], verb: 0.25 })
    voice(m + 12, at, S16 * 0.4, { type: 'sine', v: 0.018, cut: 8000, rel: 0.25, pan: [-0.3, -0.1, 0.1, 0.3][i], send: 0.15 })
  })
}
function pad(ch, t, len, cut) {
  ch.slice(1).forEach((m, i) => voice(m - 12, t, len, { v: 0.022, cut, a: 0.3, rel: 0.5, detune: [-10, 0, 10], pan: i % 2 ? 0.4 : -0.4, verb: 0.3 }))
}
// the chopped vocal-style hook: a saw through two vowel formants, short notes with an echo
function chop(m, t, len, v = 0.07, vowel = 0) {
  if (t < 0) return
  const [f1, f2] = [[800, 1200], [400, 2000], [600, 1000]][vowel]
  const g = ctx.createGain(), p = ctx.createStereoPanner()
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.012)
  g.gain.setValueAtTime(v, t + len); g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.06)
  p.pan.value = 0
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000
  for (const [f, amp] of [[f1, 1], [f2, 0.7]]) {
    const bp = ctx.createBiquadFilter(), bg = ctx.createGain()
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6; bg.gain.value = amp * 3
    lp.connect(bp).connect(bg).connect(g)
  }
  const o = ctx.createOscillator(), o2 = ctx.createOscillator()
  o.type = 'sawtooth'; o2.type = 'sawtooth'
  o.frequency.value = hz(m); o2.frequency.value = hz(m); o2.detune.value = 8
  o.connect(lp); o2.connect(lp)
  o.start(t); o2.start(t); o.stop(t + len + 0.08); o2.stop(t + len + 0.08)
  g.connect(p).connect(musicBus)
  const s = ctx.createGain(); s.gain.value = 0.35; p.connect(s).connect(echo)
  const r = ctx.createGain(); r.gain.value = 0.2; p.connect(r).connect(room)
}
// two-bar hook in F major pentatonic: [16th, midi, length in 16ths, vowel]
// ---------- UI sounds ----------
function pop(t, v = 0.25, f = 820) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.42, t + 0.07)
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13)
  o.connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.15)
}
function thump(t, v = 0.35) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.1)
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  o.connect(g).connect(sfxBus); o.start(t); o.stop(t + 0.2)
}
function click(t, v = 0.3) {
  const hp = ctx.createBiquadFilter(), g = ctx.createGain()
  hp.type = 'highpass'; hp.frequency.value = 3000
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025)
  hiss(t, 0.03).connect(hp).connect(g).connect(sfxBus)
  pop(t + 0.004, v * 0.4, 2200)
}
function whoosh(t, len = 0.45, v = 0.16) {
  const bp = ctx.createBiquadFilter(), g = ctx.createGain()
  bp.type = 'bandpass'; bp.Q.value = 1.2
  bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(3200, t + len)
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  hiss(t, len + 0.02).connect(bp).connect(g).connect(sfxBus)
}
function bell(t, f, v) {
  for (const [mul, amp, dec] of [[1, 1, 0.9], [2.01, 0.35, 0.45], [3.02, 0.15, 0.25]]) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = f * mul
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * amp, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dec)
    o.connect(g).connect(sfxBus); o.start(t); o.stop(t + dec + 0.05)
  }
}
function chime(t, v = 0.3) {
  // the win: two bright bell notes, a fifth apart
  bell(t, 1046.5, v)
  bell(t + 0.09, 1568, v * 0.85)
}
window.renderAudio = async function (seconds) {
  ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR)
  const a = ctx
  noise = a.createBuffer(1, SR * 2, SR)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1
  const glue = a.createDynamicsCompressor()
  glue.threshold.value = -14; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.2
  const master = a.createGain(); master.gain.value = 0.62
  glue.connect(master).connect(a.destination)
  // the music fades in over the first beat and out over the last two seconds
  out = a.createGain()
  out.gain.setValueAtTime(0.0001, 0); out.gain.linearRampToValueAtTime(1, 0.5)
  out.gain.setValueAtTime(1, seconds - 2.0); out.gain.linearRampToValueAtTime(0.0001, seconds - 0.05)
  out.connect(glue)
  const verb = a.createConvolver(); verb.buffer = impulse(a, 1.6)
  const verbTone = a.createBiquadFilter(); verbTone.type = 'lowpass'; verbTone.frequency.value = 5000
  room = a.createGain(); room.gain.value = 0.5; room.connect(verb).connect(verbTone).connect(out)
  // dotted-eighth echo for the plucks
  echo = a.createGain()
  const dl = a.createDelay(1); dl.delayTime.value = BEAT * 0.75
  const fb = a.createGain(); fb.gain.value = 0.32
  const et = a.createBiquadFilter(); et.type = 'lowpass'; et.frequency.value = 3500
  echo.connect(dl).connect(et).connect(fb).connect(dl); et.connect(out)
  drumBus = a.createGain(); drumBus.gain.value = 0.8; drumBus.connect(out)
  drive = saturator(a, 2.2)
  const lowEnd = a.createGain(); lowEnd.gain.value = 0.55
  drive.connect(lowEnd).connect(out)
  duck = a.createGain(); duck.connect(out)
  musicBus = a.createGain(); musicBus.gain.value = 1; musicBus.connect(duck)
  echo.disconnect(); echo.connect(dl)
  // UI sounds sit on top of the music
  sfxBus = a.createGain(); sfxBus.gain.value = 0.9
  const sfxSend = a.createGain(); sfxSend.gain.value = 0.15
  sfxBus.connect(glue); sfxBus.connect(sfxSend).connect(room)
  music(seconds)
  sfx()
  const buf = await a.startRendering()
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  const pcm = new Int16Array(L.length * 2)
  for (let i = 0; i < L.length; i++) {
    pcm[2 * i] = Math.max(-1, Math.min(1, L[i])) * 32767
    pcm[2 * i + 1] = Math.max(-1, Math.min(1, R[i])) * 32767
  }
  let bin = ''
  const bytes = new Uint8Array(pcm.buffer)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
