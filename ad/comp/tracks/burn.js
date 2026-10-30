// "The fee loop" track: 88 bpm in B flat minor (Bbm Gb Ebm F). Heavy and cinematic but still a phone-ad beat:
// half-time kick/snare with 808 slides, low braams on the drops, triplet hat rolls and its own chopped hook.
// The cuts sit on the grid: 2.73 (drop), 6.82 and 15.0 (beat 3 snares), 10.91 (second drop), 19.09 (end card).
setTempo(88)
const DROP = BAR, DROP2 = 4 * BAR, END_DROP = 7 * BAR
// 808 root, then the keys voicing
const CHORDS = [[34, 61, 65, 70, 73], [30, 61, 66, 70, 73], [27, 58, 63, 66, 70], [29, 60, 65, 69, 72]]
// two-bar hook in B flat minor: [16th, midi, length in 16ths, vowel]
const HOOK = [[0, 77, 2, 0], [2, 75, 1, 1], [3, 73, 2, 0], [6, 70, 2, 2], [8, 73, 1, 0], [10, 72, 1, 1], [11, 70, 3, 0], [14, 68, 2, 2],
  [16, 70, 2, 0], [19, 73, 1, 1], [20, 77, 3, 0], [24, 78, 2, 2], [26, 77, 1, 0], [27, 75, 1, 1], [28, 73, 4, 0]]
function hook(t, v = 0.07) { for (const [k, m, l, vw] of HOOK) chop(m, t + k * S16, l * S16 * 0.85, v, vw) }

// a low cinematic "braam": detuned saws, a filter that opens, plus the octave
function braam(ch, t, len, v = 0.05) {
  const r = ch[0] + 12
  for (const m of [r, r + 7, r + 12]) voice(m, t, len, { type: 'sawtooth', v, cut: 220, cutEnd: 1600, q: 2, a: 0.04, rel: 0.6, detune: [-14, 0, 13], pan: 0, verb: 0.35 })
}
function boom(t, v = 1) { kick(t, v); bass808(22, t, 1.4, 34, 0.55 * v); crash(t, 0.12 * v) }

// one bar of the main beat. half-time: snare on beat 3 (where the cuts land); "double" puts snares on 2 and 4
const KICK = [0, 6, 10, 11]
function beat(t, n, { dbl = false, lastBar = false } = {}) {
  for (const k of KICK) if (!(lastBar && k > 8)) kick(t + k * S16, k ? 0.82 : 1)
  if (dbl) { snare(t + 4 * S16, 0.58); snare(t + 12 * S16, 0.62); clap(t + 12 * S16, 0.3) }
  else { snare(t + 8 * S16, 0.68); clap(t + 8 * S16, 0.35); if (!lastBar) snare(t + 15 * S16, 0.16) }
  for (let k = 0; k < 16; k++) {
    if (lastBar && k >= 12) break
    // triplet rolls on the 4th beat of odd bars, 32nds before the snare on even bars
    if (n % 2 === 1 && k >= 12 && k < 14) for (let j = 0; j < 3; j++) hat(t + k * S16 + j * S16 / 3, 0.06 + j * 0.01)
    else if (n % 2 === 0 && k === 7) { hat(t + k * S16, 0.07); hat(t + k * S16 + S16 / 2, 0.05) }
    else hat(t + k * S16, k % 4 === 0 ? 0.09 : k % 2 ? 0.04 : 0.065, k === 14 && n % 2 === 0)
    shaker(t + k * S16 + S16 * 0.12, k % 2 ? 0.035 : 0.02)
  }
}
function bassLine(ch, t, n, lastBar = false) {
  const prev = CHORDS[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 6 * S16, prev !== ch[0] ? prev : null, 0.5)
  if (lastBar) return
  bass808(ch[0], t + 6 * S16, 4 * S16, null, 0.42)
  bass808(ch[0] + 12, t + 10 * S16, 2 * S16, ch[0], 0.4)
  bass808(ch[0] + 7, t + 12 * S16, 4 * S16, null, 0.4)
}

function music(seconds) {
  for (let n = 0; ; n++) {
    const t = n * BAR
    if (t >= seconds - 0.3) break
    const ch = CHORDS[n % 4]
    if (n === 0) {
      // the hook bar: a boom on "Every trade", then the flame erupts on beat 3 with a braam
      boom(0.08, 0.9)
      keys(ch, t, false, [0, 3, 6])
      boom(2 * BEAT, 1)
      braam(ch, 2 * BEAT, 2 * BEAT - 0.15, 0.04)
      for (let k = 8; k < 15; k++) hat(t + k * S16, 0.04 + k * 0.004)
      continue
    }
    const sec2 = t >= DROP2 - 0.01 && t < END_DROP - 0.01
    const fin = t >= END_DROP - 0.01
    const last = n === 6 // into the end card: a beat of silence and a roll
    pad(ch, t, BAR, sec2 || fin ? 3000 : 1600)
    keys(ch, t, true, sec2 ? [0, 3, 6, 10, 12, 14] : [0, 3, 6, 10])
    beat(t, n, { dbl: sec2 && !last, lastBar: last })
    bassLine(ch, t, n, last)
    if (n === 1 || n === 4 || fin) braam(ch, t, BAR * 0.9, 0.035)
    if (n === 1 || n === 4 || fin) crash(t, 0.2)
    // the hook: answered in the first section, full in the second and over the end card
    if (n === 2) hook(t, 0.07)
    if (n === 4) hook(t, 0.085)
    if (fin) hook(t, 0.085)
    // beat-3 impacts on the 6.82 and 15.0 cuts
    if (n === 2 || n === 5) { crash(t + 8 * S16, 0.14); kick(t + 8 * S16, 0.9) }
  }
  riser(0.6, DROP - BEAT * 0.25, 0.1)
  roll(DROP - 2 * BEAT, DROP - BEAT * 0.25, 0.1, 0.4)
  riser(DROP2 - BAR, DROP2 - 0.05, 0.1)
  riser(END_DROP - BAR, END_DROP - BEAT * 0.25, 0.15)
  roll(END_DROP - 2 * BEAT, END_DROP - BEAT * 0.25, 0.1, 0.5)
  boom(END_DROP, 0.9)
}

// fire crackle: a few short filtered noise ticks
function crackle(t, len = 0.5, v = 0.12) {
  for (let i = 0; i < len * 30; i++) {
    const at = t + rand() * len
    const bp = ctx.createBiquadFilter(), g = ctx.createGain()
    bp.type = 'bandpass'; bp.frequency.value = 1500 + rand() * 4000; bp.Q.value = 3
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(v * (0.4 + rand() * 0.6), at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02)
    hiss(at, 0.03).connect(bp).connect(g).connect(sfxBus)
  }
}
function fireWhoosh(t, len = 0.6, v = 0.18) {
  const lp = ctx.createBiquadFilter(), g = ctx.createGain()
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2400, t + len * 0.4); lp.frequency.exponentialRampToValueAtTime(600, t + len)
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
  hiss(t, len + 0.05).connect(lp).connect(g).connect(sfxBus)
}

function sfx() {
  const C1 = BAR, C2 = BAR + 6 * BEAT, C3 = 4 * BAR, C4 = 4 * BAR + 6 * BEAT, C5 = 7 * BAR
  // 1. hook: the flame erupts
  whoosh(1.0, 0.36, 0.12)
  fireWhoosh(1.36, 0.9, 0.22)
  crackle(1.4, 1.1, 0.1)
  // 2. $GRID split: pill pop, bar fill, coins; the orange ones land in the flame
  whoosh(C1 - 0.35, 0.4)
  pop(C1 + 0.27, 0.26, 700)
  whoosh(C1 + 0.68, 0.7, 0.1)
  pop(C1 + 1.2, 0.16, 1200)
  for (let i = 0; i < 26; i++) {
    const t0 = C1 + 0.9 + i * 0.16
    if (i % 5 === 4) { thump(t0 + 0.75, 0.14); crackle(t0 + 0.75, 0.25, 0.08) }
    else pop(t0 + 0.06, 0.05, 1500 + (i % 4) * 140)
  }
  fireWhoosh(C1 + 1.5, 0.6, 0.12)
  // 3. the family pops in round the flame, then the crowd
  for (let i = 0; i < 10; i++) pop(C2 + 0.27 + i * 0.07, 0.12, 640 + i * 50)
  fireWhoosh(C2 + 0.15, 0.8, 0.16)
  for (let i = 0; i < 12; i++) pop(C2 + 2.02 + i * 0.045, 0.05, 900 + (i % 5) * 110)
  crackle(C2 + 1.2, 2.6, 0.06)
  // 4. docs: page in, the click, the bars fill, a little flame
  whoosh(C3 - 0.4, 0.45)
  click(C3 + 1.35, 0.35)
  whoosh(C3 + 1.5, 0.55, 0.1)
  pop(C3 + 2.15, 0.14, 1100); pop(C3 + 2.6, 0.14, 1250)
  fireWhoosh(C3 + 2.6, 0.4, 0.08)
  // 5. stats: the tiles, the burned tile lights, the tag
  whoosh(C4 - 0.4, 0.45)
  for (let i = 0; i < 6; i++) pop(C4 + 0.2 + i * 0.08, 0.06, 1000 + i * 70)
  chime(C4 + 1.95, 0.4)
  fireWhoosh(C4 + 2.2, 0.5, 0.1)
  pop(C4 + 2.62, 0.2, 900)
  // 6. end card
  ;[0.25, 0.5, 0.6, 0.7, 0.8, 0.9].forEach((a) => thump(C5 + 0.05 + a, 0.2))
  pop(C5 + 1.02, 0.28, 700)
  chime(C5 + 2.1, 0.35)
}
