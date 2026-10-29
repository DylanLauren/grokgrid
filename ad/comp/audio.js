// Soundtrack for the ad: an upbeat synth-pop bed (120 bpm, Am F C G) written for this cut, plus small UI
// sounds timed to the picture. Everything is synthesised offline, so every render is identical.
// renderAudio(seconds) -> 16-bit stereo PCM at 48 kHz, as base64 for the encoder.
;(function () {
  const SR = 48000
  const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4
  // bars land on the cuts: the logo reveal (3.4 s) is a downbeat, and so is the end card (33.4 s)
  const T0 = 3.4 - 2 * BAR
  const DROP = 3.4, BREAK = 29.4, END_DROP = 33.4
  // a minor, F, C, G: one chord a bar, as midi notes (root, then the chord tones)
  const CHORDS = [[45, 57, 60, 64, 67], [41, 57, 60, 65, 69], [48, 55, 60, 64, 67], [43, 55, 59, 62, 67]]
  let seed = 20261029
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

  let ctx, out, room, echo, drumBus, musicBus, duck, sfxBus, noise

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

  // ---------- drums ----------
  function kick(t, v = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09)
    g.gain.setValueAtTime(v, t); g.gain.setValueAtTime(v, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.45)
    const hp = ctx.createBiquadFilter(), cg = ctx.createGain()
    hp.type = 'highpass'; hp.frequency.value = 2500
    env(cg, t, 0.25 * v, 0.001, 0.012)
    hiss(t, 0.02).connect(hp).connect(cg).connect(drumBus)
    // everything melodic ducks under the kick, so the beat pumps
    duck.gain.setValueAtTime(1, t - 0.005); duck.gain.linearRampToValueAtTime(0.3, t + 0.01); duck.gain.setTargetAtTime(1, t + 0.04, 0.09)
  }
  function clap(t, v = 0.5) {
    const bp = ctx.createBiquadFilter(), g = ctx.createGain()
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9
    g.gain.setValueAtTime(0.0001, t)
    for (const d of [0, 0.011, 0.022]) { g.gain.setValueAtTime(v, t + d); g.gain.exponentialRampToValueAtTime(v * 0.15, t + d + 0.01) }
    g.gain.setValueAtTime(v * 0.8, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    hiss(t, 0.25).connect(bp).connect(g).connect(drumBus)
    const s = ctx.createGain(); s.gain.value = 0.35; g.connect(s).connect(room)
  }
  function hat(t, v = 0.12, open = false) {
    const hp = ctx.createBiquadFilter(), g = ctx.createGain()
    hp.type = 'highpass'; hp.frequency.value = open ? 7000 : 8500
    env(g, t, v, 0.001, open ? 0.16 : 0.035)
    hiss(t, open ? 0.2 : 0.05).connect(hp).connect(g).connect(drumBus)
  }
  function crash(t, v = 0.22) {
    const hp = ctx.createBiquadFilter(), g = ctx.createGain()
    hp.type = 'highpass'; hp.frequency.value = 4500
    env(g, t, v, 0.002, 1.8)
    hiss(t, 2).connect(hp).connect(g).connect(drumBus)
    const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s).connect(room)
  }
  function riser(t0, t1, v = 0.16) {
    const bp = ctx.createBiquadFilter(), g = ctx.createGain()
    bp.type = 'bandpass'; bp.Q.value = 2
    bp.frequency.setValueAtTime(400, t0); bp.frequency.exponentialRampToValueAtTime(7000, t1)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t1 - 0.02); g.gain.linearRampToValueAtTime(0.0001, t1)
    hiss(t0, t1 - t0 + 0.05).connect(bp).connect(g).connect(musicBus)
  }
  function snareRoll(t0, t1) {
    // the build into a drop: claps speeding up and getting louder
    let t = t0, step = BEAT / 2
    while (t < t1 - 0.01) {
      const k = (t - t0) / (t1 - t0)
      clap(t, 0.12 + 0.3 * k)
      if (k > 0.5) step = BEAT / 4
      if (k > 0.8) step = BEAT / 8
      t += step
    }
  }

  // ---------- synths ----------
  function voice(m, t, len, { type = 'sawtooth', v = 0.1, cut = 2000, cutEnd = null, a = 0.005, rel = 0.12, detune = [0], bus = musicBus, pan = 0, send = 0 }) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner()
    f.type = 'lowpass'; f.Q.value = 1.2
    f.frequency.setValueAtTime(cut, t)
    if (cutEnd) f.frequency.exponentialRampToValueAtTime(cutEnd, t + len)
    p.pan.value = pan
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a)
    g.gain.setValueAtTime(v, t + Math.max(a, len)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, len) + rel)
    f.connect(g).connect(p).connect(bus)
    if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s).connect(echo) }
    for (const d of detune) {
      const o = ctx.createOscillator()
      o.type = type; o.frequency.value = hz(m); o.detune.value = d
      o.connect(f); o.start(t); o.stop(t + Math.max(a, len) + rel + 0.02)
    }
  }
  function pad(ch, t, len, open) {
    ch.slice(1).forEach((m, i) => voice(m, t, len, { v: 0.035, cut: open ? 2400 : 900, a: 0.25, rel: 0.6, detune: [-9, 0, 9], pan: i % 2 ? 0.3 : -0.3, send: 0.1 }))
  }
  function bass(ch, t) {
    // offbeat pluck bass with a clean sub underneath
    const r = ch[0] - 12 < 33 ? ch[0] : ch[0] - 12
    for (let b = 0; b < 4; b++) {
      const at = t + b * BEAT + BEAT / 2
      voice(r, at, BEAT * 0.38, { v: 0.16, cut: 1300, cutEnd: 260, rel: 0.05, detune: [-6, 6] })
      voice(r, at, BEAT * 0.38, { type: 'sine', v: 0.26, cut: 400, rel: 0.05 })
    }
  }
  const STAB = [0, 1.5, 3, 4.5, 6, 7] // in eighths
  function stabs(ch, t) {
    for (const e of STAB) ch.slice(1, 4).forEach((m, i) => voice(m + 12, t + e * BEAT / 2, BEAT * 0.22, { type: 'square', v: 0.028, cut: 3400, cutEnd: 900, rel: 0.08, pan: [-0.25, 0, 0.25][i], send: 0.18 }))
  }
  function arp(ch, t, bright) {
    const notes = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[4] + 12, ch[3] + 12, ch[2] + 12, ch[3] + 12, ch[4] + 12]
    for (let i = 0; i < 16; i++) voice(notes[i % 8] + (i >= 12 && bright ? 12 : 0), t + i * BEAT / 4, BEAT * 0.16, { type: 'triangle', v: 0.05, cut: 6000, rel: 0.06, pan: i % 2 ? 0.35 : -0.35, send: 0.3 })
  }
  // a short hook the lead plays over the end card
  const HOOK = [[0, 76, 1], [1, 79, 1], [2, 81, 1.5], [3.5, 79, 0.5], [4, 76, 1], [5, 74, 1], [6, 72, 2]]
  function hook(t) {
    for (const [b, m, l] of HOOK) voice(m, t + b * BEAT, l * BEAT * 0.9, { type: 'square', v: 0.045, cut: 3800, a: 0.01, rel: 0.2, detune: [-7, 7], send: 0.3 })
  }

  function music(seconds) {
    for (let n = 0; ; n++) {
      const t = T0 + n * BAR
      if (t >= seconds - 0.5) break
      const ch = CHORDS[((n % 4) + 4) % 4]
      if (t + BAR <= 0) continue
      const main = t >= DROP - 0.01 && t < BREAK - 0.01
      const brk = t >= BREAK - 0.01 && t < END_DROP - 0.01
      const fin = t >= END_DROP - 0.01
      const tail = t + BAR > seconds - 1.2
      pad(ch, Math.max(0, t), BAR, main || fin || brk)
      if (main || fin) {
        bass(ch, t)
        if (t >= 6.4 - 0.01) stabs(ch, t)
        if (t >= 10.8 - 0.6 || fin) arp(ch, t, fin)
        for (let b = 0; b < 4; b++) {
          if (!(tail && b > 1)) kick(t + b * BEAT, 0.95)
          if (b % 2) clap(t + b * BEAT, 0.42)
          hat(t + b * BEAT + BEAT / 2, 0.11, true)
          if (t >= 6.4 - 0.01) { hat(t + b * BEAT + BEAT / 4, 0.045); hat(t + b * BEAT + 3 * BEAT / 4, 0.045) }
        }
      }
      if (fin && n % 2 === 0) hook(t)
      if (brk) {
        // the break: open pad, the arp, bass and claps only, then it builds back
        arp(ch, t, false)
        bass(ch, t)
        for (let b = 0; b < 4; b++) { if (b % 2) clap(t + b * BEAT, 0.3); hat(t + b * BEAT + BEAT / 2, 0.07, true) }
      }
    }
    // intro: pad only, then a riser and clap roll into the logo
    riser(1.4, DROP, 0.12)
    snareRoll(2.4, DROP)
    crash(DROP, 0.2)
    // the 6.4 s cut and the 20 s cut get a lift, the fee loop break builds back into the end card
    crash(6.4, 0.12); crash(20.0 - 0.6 + 0.6, 0.1)
    riser(BREAK + 1.2, END_DROP, 0.16)
    snareRoll(END_DROP - BAR, END_DROP)
    crash(END_DROP, 0.26)
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
})()
