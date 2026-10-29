// Soundtrack for the ad: the site's own late-night jazz trio (same tune, voicings and samples as
// src/lib/jazz.ts), rendered offline with a fixed seed, plus small UI sounds timed to the picture.
// renderAudio(seconds) -> Float32 interleaved stereo at 48 kHz, as base64 for the encoder.
;(function () {
  const SR = 48000
  // dlao dropped the site's jazz (2026-10-29), so the ad ships with UI sounds only; MUSIC=true brings the trio back
  const MUSIC = new URLSearchParams(location.search).get('music') === '1'
  const BPM = 84, BEAT = 60 / BPM, BAR = BEAT * 4, SWING = 0.64, VOLUME = 0.55
  const BASE = '../assets/jazz/'
  const PIANO = { 33: 'A1', 36: 'C2', 39: 'Ds2', 42: 'Fs2', 45: 'A2', 48: 'C3', 51: 'Ds3', 54: 'Fs3', 57: 'A3', 60: 'C4', 63: 'Ds4', 66: 'Fs4', 69: 'A4', 72: 'C5', 75: 'Ds5', 78: 'Fs5', 81: 'A5', 84: 'C6' }
  const BASS = { 28: 'E1', 31: 'G1', 34: 'As1', 37: 'Cs2', 40: 'E2', 43: 'G2', 46: 'As2', 49: 'Cs3', 52: 'E3' }
  const QUAL = {
    maj7: { tones: [0, 4, 7, 11], scale: [0, 2, 4, 7, 9, 11], a: [4, 7, 11, 14], b: [11, 14, 16, 19] },
    m7: { tones: [0, 3, 7, 10], scale: [0, 2, 3, 5, 7, 9, 10], a: [3, 7, 10, 14], b: [10, 14, 15, 19] },
    '7': { tones: [0, 4, 7, 10], scale: [0, 2, 4, 7, 9, 10], a: [4, 9, 10, 14], b: [10, 14, 16, 21] },
    '9': { tones: [0, 4, 7, 10], scale: [0, 2, 4, 5, 7, 9, 10], a: [4, 7, 10, 14], b: [10, 14, 16, 19] },
    '7b9': { tones: [0, 4, 7, 10], scale: [0, 1, 3, 4, 7, 8, 10], a: [4, 8, 10, 13], b: [10, 13, 16, 20] },
    m7b5: { tones: [0, 3, 6, 10], scale: [0, 3, 5, 6, 8, 10], a: [3, 6, 10, 14], b: [10, 14, 15, 18] },
    m6: { tones: [0, 3, 7, 9], scale: [0, 2, 3, 5, 7, 9, 11], a: [3, 7, 9, 14], b: [9, 14, 15, 19] },
    dim7: { tones: [0, 3, 6, 9], scale: [0, 2, 3, 5, 6, 8, 9, 11], a: [3, 6, 9, 12], b: [6, 9, 12, 15] },
  }
  const c = (pc, q) => ({ pc, q })
  const F = 5, D = 2, G = 7, C = 0, A = 9, Bb = 10, Ab = 8, E = 4
  const FORM = [
    [c(F, 'maj7')], [c(D, '7b9')], [c(G, 'm7')], [c(C, '7')],
    [c(A, 'm7')], [c(D, '7b9')], [c(G, 'm7')], [c(C, '9')],
    [c(F, 'maj7')], [c(F, '7')], [c(Bb, 'maj7')], [c(Bb, 'm6')],
    [c(A, 'm7')], [c(Ab, 'dim7')], [c(G, 'm7'), c(C, '7')], [c(F, 'maj7'), c(E, 'm7b5')],
  ]
  // fixed seed so every render of the ad has the same take
  let seed = 20261029
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const pick = (a) => a[Math.floor(rand() * a.length)]
  const chance = (p) => rand() < p
  const human = (ms = 12) => ((rand() - 0.5) * 2 * ms) / 1000
  const near = (pc, to) => { let m = pc + 12 * Math.round((to - pc) / 12); if (m - to > 6) m -= 12; if (to - m > 6) m += 12; return m }

  let ctx, out, room, pianoBus, bassBus, kitBus, sfxBus, noise
  const buffers = { piano: new Map(), bass: new Map() }
  let lhLow = 53, bassNote = 41, melNote = 72, phraseLeft = 0, rest = 1

  function impulse(a, secs) {
    const len = Math.floor(a.sampleRate * secs)
    const b = a.createBuffer(2, len, a.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        const early = i < a.sampleRate * 0.08 && rand() < 0.002 ? 0.6 : 0
        d[i] = ((rand() * 2 - 1) * Math.pow(1 - i / len, 4) + early) * 0.9
      }
    }
    return b
  }
  function bus(a, level, wet, pan) {
    const g = a.createGain(); g.gain.value = level
    const p = a.createStereoPanner(); p.pan.value = pan
    g.connect(p).connect(out)
    const send = a.createGain(); send.gain.value = wet
    g.connect(send).connect(room)
    return g
  }
  const at = (t0, k) => t0 + (Math.floor(k / 2) + (k % 2 ? SWING : 0)) * BEAT

  function playBar(t0, n) {
    const chords = FORM[n % FORM.length]
    const nextChord = FORM[(n + 1) % FORM.length][0]
    const chorus = Math.floor(n / FORM.length)
    const beatsEach = 4 / chords.length
    chords.forEach((ch, i) => {
      const start = t0 + i * beatsEach * BEAT
      const following = chords[i + 1] || nextChord
      walk(ch, following, start, beatsEach, chorus === 0 && n % FORM.length < 4)
      comp(ch, start, beatsEach, i)
    })
    melody(chords, t0, n)
    drums(t0, n)
  }
  function walk(ch, next, t, beats, twoFeel) {
    const root = near(ch.pc, bassNote)
    const r = root < 29 ? root + 12 : root > 45 ? root - 12 : root
    const target = near(next.pc, r)
    const q = QUAL[ch.q]
    const notes = [r]
    if (twoFeel && beats === 4) {
      const fifth = r + 7 > 47 ? r - 5 : r + 7
      note('bass', r, t + human(6), BEAT * 1.9, 0.82)
      note('bass', fifth, t + 2 * BEAT + human(6), BEAT * 1.9, 0.74)
      bassNote = fifth
      return
    }
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
    notes.forEach((m, b) => note('bass', m, t + b * BEAT + human(6), BEAT * 0.92, b === 0 ? 0.86 : 0.74 + rand() * 0.08))
    bassNote = notes[notes.length - 1]
  }
  function voicing(ch) {
    const q = QUAL[ch.q]
    const options = [q.a, q.b].flatMap((shape) => [-12, 0, 12].map((o) => shape.map((x) => ch.pc + 48 + o + x)))
    const fit = options.filter((v) => v[0] >= 50 && v[0] <= 60)
    const best = (fit.length ? fit : options).reduce((x, y) => (Math.abs(y[0] - lhLow) < Math.abs(x[0] - lhLow) ? y : x))
    lhLow = best[0]
    return best
  }
  const COMPS = [[0], [3], [0, 3], [1, 5], [3, 6], [0, 5], [2, 7], [5]]
  function comp(ch, t, beats, i) {
    const v = voicing(ch)
    const hits = beats === 4 ? pick(COMPS) : chance(0.6) ? [0] : [1]
    hits.forEach((k, j) => {
      const when = at(t, k) + human(10)
      const len = j === hits.length - 1 && chance(0.5) ? BEAT * 1.4 : BEAT * (0.35 + rand() * 0.25)
      const vel = 0.36 + rand() * 0.1 + (i === 0 && k === 0 ? 0.04 : 0)
      v.forEach((m, x) => note('piano', m, when + x * 0.006, len, vel - x * 0.015))
    })
  }
  function melody(chords, t0, n) {
    if (phraseLeft <= 0) {
      if (rest > 0) { rest--; return }
      phraseLeft = chance(0.55) ? 2 : 1
    }
    phraseLeft--
    const endsHere = phraseLeft === 0
    let k = n % 4 === 0 ? 0 : pick([0, 1, 2, 3])
    while (k < 8) {
      const ch = chords[chords.length === 2 && k >= 4 ? 1 : 0]
      const q = QUAL[ch.q]
      const strong = k % 2 === 0
      const last = endsHere && k >= 5
      const set = (strong || last ? [...q.tones, ...(ch.q === 'maj7' || ch.q === 'm7' ? [14] : [])] : q.scale).flatMap((x) => [48, 60, 72, 84].map((o) => ch.pc + o + x)).filter((m) => m >= 64 && m <= 86)
      const around = set.filter((m) => m !== melNote && Math.abs(m - melNote) <= (strong ? 5 : 3))
      const m = around.length ? pick(around) : set.reduce((x, y) => (Math.abs(y - melNote) < Math.abs(x - melNote) ? y : x))
      const len = last ? BEAT * (1.5 + rand()) : chance(0.2) ? BEAT : BEAT * 0.5
      const vel = (strong ? 0.48 : 0.56) + rand() * 0.08 - (chance(0.12) ? 0.2 : 0)
      note('piano', m, at(t0, k) + human(14), len * 0.95, vel)
      melNote = m
      if (last) break
      k += len >= BEAT ? 2 : 1
    }
    if (endsHere) { rest = pick([1, 1, 2]); if (melNote > 80) melNote -= 5; if (melNote < 66) melNote += 5 }
  }
  function note(kind, m, t, len, vel) {
    const a = ctx, table = buffers[kind]
    if (!table.size || t < 0) return
    let src = 0, best = Infinity
    for (const k of table.keys()) if (Math.abs(k - m) < best) (best = Math.abs(k - m)), (src = k)
    const s = a.createBufferSource()
    s.buffer = table.get(src)
    s.playbackRate.value = Math.pow(2, (m - src) / 12)
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
    s.start(t)
    s.stop(end + release + 0.02)
  }
  function hiss(t, len, bus) {
    const s = ctx.createBufferSource()
    s.buffer = noise
    s.start(t, rand() * 1.5)
    s.stop(t + len)
    return s
  }
  // an ad wants a little more drive than the room: brushes plus a ride from the start
  function drums(t0, n) {
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * BEAT
      swish(t, BEAT, 0.05 + (b % 2 ? 0.014 : 0))
      if (b % 2 === 1) { tap(t + human(5), 0.1); if (chance(0.7)) tap(at(t0, b * 2 - 1) + human(5), 0.035); chick(t + human(4), 0.07) }
    }
    if (n >= 2) for (const k of [0, 2, 3, 4, 6, 7]) if (k % 2 === 0 || chance(0.85)) ride(at(t0, k) + human(5), k % 2 ? 0.028 : 0.045)
    kick(t0 + human(5), 0.09)
  }
  function swish(t, len, v) {
    const bp = ctx.createBiquadFilter(), g = ctx.createGain()
    bp.type = 'bandpass'; bp.Q.value = 0.7
    bp.frequency.setValueAtTime(2600, t); bp.frequency.linearRampToValueAtTime(4200, t + len * 0.6); bp.frequency.linearRampToValueAtTime(3000, t + len)
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + len * 0.45); g.gain.linearRampToValueAtTime(0.0001, t + len)
    hiss(t, len + 0.02).connect(bp).connect(g).connect(kitBus)
  }
  function tap(t, v) {
    const bp = ctx.createBiquadFilter(), g = ctx.createGain()
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.9
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    hiss(t, 0.2).connect(bp).connect(g).connect(kitBus)
  }
  function chick(t, v) {
    const hp = ctx.createBiquadFilter(), g = ctx.createGain()
    hp.type = 'highpass'; hp.frequency.value = 7000
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    hiss(t, 0.06).connect(hp).connect(g).connect(kitBus)
  }
  function ride(t, v) {
    const hp = ctx.createBiquadFilter(), bp = ctx.createBiquadFilter(), g = ctx.createGain()
    hp.type = 'highpass'; hp.frequency.value = 6000
    bp.type = 'peaking'; bp.frequency.value = 9500; bp.gain.value = 6
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(v * 0.25, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
    hiss(t, 0.75).connect(hp).connect(bp).connect(g).connect(kitBus)
  }
  function kick(t, v) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(65, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    o.connect(g).connect(kitBus); o.start(t); o.stop(t + 0.3)
  }

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
  function sfx() {
    // timed to comp.js
    pop(0.2, 0.12, 600)
    ;[0.42, 0.84, 1.3].forEach((d) => thump(1.05 + d, 0.28))
    whoosh(3.2, 0.4)
    pop(3.5, 0.3, 700)
    for (let i = 0; i < 9; i++) pop(3.62 + i * 0.05, 0.08, 900 + i * 60)
    whoosh(6.2, 0.4)
    pop(7.62, 0.22, 900)
    chime(8.97, 0.55)
    pop(9.28, 0.2, 1000)
    whoosh(10.6, 0.5)
    click(13.0, 0.35)
    pop(13.72, 0.24, 760)
    whoosh(15.6, 0.5)
    whoosh(19.85, 0.5)
    click(22.6, 0.35)
    for (let i = 0; i < 9; i++) thump(22.9 + i * 0.38, 0.12)
    whoosh(25.0, 0.45)
    pop(25.78, 0.26, 700)
    whoosh(26.75, 0.9, 0.12)
    pop(27.45, 0.18, 1200)
    whoosh(28.2, 0.35, 0.1)
    for (let i = 0; i < 24; i++) pop(29.92 + i * 0.022, 0.06, 700 + (i % 6) * 120)
    thump(33.75, 0.3)
    ;[0.18, 0.28, 0.38, 0.48, 0.58, 0.68].forEach((a) => thump(33.5 + a + 0.32, 0.22))
    pop(35.02, 0.3, 700)
    pop(35.92, 0.28, 880)
    chime(36.3, 0.4)
  }

  window.renderAudio = async function (seconds) {
    ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR)
    const a = ctx
    // samples
    const files = [...Object.entries(PIANO).map(([m, n]) => ['piano', +m, `piano-${n}`]), ...Object.entries(BASS).map(([m, n]) => ['bass', +m, `bass-${n}`])]
    if (MUSIC) await Promise.all(files.map(async ([kind, m, f]) => {
      const data = await (await fetch(`${BASE}${f}.mp3`)).arrayBuffer()
      buffers[kind].set(m, await a.decodeAudioData(data))
    }))
    out = a.createGain()
    out.gain.setValueAtTime(0, 0)
    out.gain.linearRampToValueAtTime(VOLUME, 0.6)
    out.gain.setValueAtTime(VOLUME, seconds - 2.2)
    out.gain.linearRampToValueAtTime(0, seconds - 0.1)
    const glue = a.createDynamicsCompressor()
    glue.threshold.value = -18; glue.ratio.value = 2.5; glue.attack.value = 0.015; glue.release.value = 0.25
    const tape = a.createBiquadFilter(); tape.type = 'lowpass'; tape.frequency.value = 9000
    const master = a.createGain(); master.gain.value = MUSIC ? 1.6 : 0.8
    out.connect(tape).connect(glue).connect(master).connect(a.destination)
    const verb = a.createConvolver(); verb.buffer = impulse(a, 1.9)
    const verbTone = a.createBiquadFilter(); verbTone.type = 'lowpass'; verbTone.frequency.value = 4200
    room = a.createGain(); room.connect(verb).connect(verbTone).connect(out)
    pianoBus = bus(a, 0.9, 0.22, -0.12)
    bassBus = bus(a, 1.05, 0.08, 0.05)
    kitBus = bus(a, 0.55, 0.18, 0.22)
    sfxBus = a.createGain(); sfxBus.gain.value = 1.0
    const sfxSend = a.createGain(); sfxSend.gain.value = 0.12
    sfxBus.connect(glue); sfxBus.connect(sfxSend).connect(room)
    noise = a.createBuffer(1, SR * 2, SR)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1
    // a little faster than the room so the cut moves: one bar every ~2.86 s at 84 bpm
    if (MUSIC) for (let n = 0, t = 0.05; t < seconds; n++, t += BAR) playBar(t, n)
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
})()
