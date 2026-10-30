// Stats feature track: 92 bpm in G major (G Bm C D), confident and punchy. Syncopated kick (1, a, 3, a),
// clap-snares on 2 and 4, an 808 that bounces between root and octave, and its own hook: a chopped vocal
// line doubled by a square pluck. Every bar line lands on a scene cut in cuts/stats.js.
setTempo(92)
const DROP = BAR, HOOK_IN = 3 * BAR, BRK = 5 * BAR, END_DROP = 6 * BAR // 2.61, 7.83, 13.04, 15.65
// G, B minor, C, D: 808 root, then the keys voicing
const CHORDS = [[31, 62, 67, 71, 74], [35, 62, 66, 71, 74], [36, 60, 64, 67, 72], [38, 62, 66, 69, 74]]
// two-bar hook, G major pentatonic: [16th, midi, length in 16ths, vowel]
const HOOK = [[0, 74, 2, 0], [2, 74, 1, 1], [3, 76, 1, 0], [4, 79, 2, 2], [7, 76, 1, 0], [8, 74, 2, 1], [10, 71, 2, 0], [12, 74, 3, 2],
  [16, 74, 2, 0], [18, 74, 1, 1], [19, 76, 1, 0], [20, 79, 1, 2], [21, 81, 2, 0], [24, 79, 2, 1], [26, 76, 1, 0], [27, 74, 1, 1], [28, 71, 4, 0]]
function hook(t, v = 0.065, upto = 32) {
  for (const [k, m, l, vw] of HOOK) {
    if (k >= upto) break
    chop(m, t + k * S16, l * S16 * 0.8, v, vw)
    voice(m - 12, t + k * S16, l * S16 * 0.5, { type: 'square', v: v * 0.28, cut: 2600, cutEnd: 900, rel: 0.08, pan: 0.15, send: 0.12 })
  }
}

const KICK = [0, 3, 8, 11]
function beat(t, n, { fill = false } = {}) {
  for (const k of KICK) kick(t + k * S16, k === 0 ? 1 : k === 8 ? 0.9 : 0.75)
  snare(t + 4 * S16, 0.6); snare(t + 12 * S16, 0.64)
  clap(t + 12 * S16 + 0.01, 0.25)
  for (let k = 0; k < 16; k += 2) hat(t + k * S16, k % 4 === 2 ? 0.1 : 0.065, k === 14 && n % 2 === 0)
  // 16th pairs on the "e" of 2 and 4, and a triplet roll closing every other bar
  hat(t + 7 * S16, 0.045); hat(t + 15 * S16, 0.045)
  if (fill || n % 2 === 1) for (let j = 0; j < 6; j++) hat(t + 13 * S16 + (j * 2 * S16) / 6, 0.04 + j * 0.008)
  for (let k = 1; k < 16; k += 2) shaker(t + k * S16, 0.03)
}
function bassLine(ch, t, n) {
  const prev = CHORDS[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 3 * S16, prev !== ch[0] ? prev : null, 0.5)
  bass808(ch[0], t + 3 * S16, 5 * S16, null, 0.42)
  bass808(ch[0] + 12, t + 8 * S16, 3 * S16, null, 0.4)
  bass808(ch[0], t + 11 * S16, 5 * S16, ch[0] + 12, 0.44)
}

function music(seconds) {
  for (let n = 0; ; n++) {
    const t = n * BAR
    if (t >= seconds - 0.3) break
    const ch = CHORDS[n % 4]
    if (t < DROP - 0.01) {
      // intro: one hard hit on the first frame, then filtered stabs, claps and a riser into the drop
      kick(0.02, 1); bass808(ch[0], 0.02, BEAT * 1.5, null, 0.45); crash(0.02, 0.12)
      keys(ch, t, false, [0, 3, 6, 8, 11])
      clap(t + 4 * S16, 0.3); clap(t + 12 * S16, 0.34)
      for (let k = 0; k < 12; k += 2) hat(t + k * S16, 0.05)
      continue
    }
    const brk = t >= BRK - 0.01 && t < END_DROP - 0.01
    pad(ch, t, BAR, brk ? 1200 : 2800)
    keys(ch, t, true, [0, 3, 6, 8, 11])
    if (brk) {
      // stop-time: "He wins some. He loses some." on two hits, the hook alone, a roll back in
      kick(t, 1); bass808(ch[0], t, BEAT * 1.4, null, 0.48)
      kick(t + 6 * S16, 0.8); bass808(ch[0] + 12, t + 6 * S16, BEAT, null, 0.38)
      snare(t + 4 * S16, 0.55)
      for (let k = 0; k < 8; k += 2) hat(t + k * S16, 0.05)
      hook(t, 0.06, 13)
      continue
    }
    beat(t, n, { fill: t + BAR >= HOOK_IN - 0.01 && t < HOOK_IN })
    bassLine(ch, t, n)
    if (t >= HOOK_IN - 0.01 && (n - 3) % 2 === 0) hook(t, 0.065)
    if (t >= END_DROP - 0.01 && (n - 6) % 2 === 0) hook(t, 0.075)
    if (n === 1 || n === 3 || n === 6) crash(t, 0.14)
  }
  // a quarter beat of air before each drop
  riser(0.6, DROP - BEAT * 0.25, 0.1)
  roll(DROP - BEAT * 2, DROP - BEAT * 0.25, 0.1, 0.4)
  crash(DROP, 0.22)
  riser(BRK + BEAT, END_DROP - BEAT * 0.25, 0.15)
  roll(END_DROP - BEAT * 2, END_DROP - BEAT * 0.25, 0.1, 0.5)
  crash(END_DROP, 0.26)
}

// a count-up: ticks spaced like the eased number (fast first, settling), pitch climbing
function ticks(t0, t1, n, v = 0.05, f0 = 1100, f1 = 2000) {
  for (let i = 1; i <= n; i++) {
    const x = 1 - Math.pow(1 - i / n, 1 / 4)
    pop(t0 + (t1 - t0) * x, v, f0 + (f1 - f0) * (i / n))
  }
}
function sfx() {
  const B1 = BAR, B3 = 3 * BAR, B4 = 4 * BAR, B5 = 5 * BAR, B6 = 6 * BAR, SB = BEAT
  // 1. hook: the number spins up, the face lands
  whoosh(0.0, 0.3, 0.1)
  pop(0.1, 0.22, 700)
  ticks(0.15, 1.35, 14, 0.045)
  whoosh(1.15, 0.35, 0.08)
  whoosh(B1 - 0.4, 0.4, 0.12)
  // 2. wallet: count-up, pills on the beat, the chart sweep, the cursor lands on the line
  ticks(B1 + 0.05, B1 + 1.2, 12, 0.045, 1200, 2100)
  for (let i = 0; i < 3; i++) pop(B1 + 1.32 + (i * SB) / 2, 0.2, 760 + i * 160)
  whoosh(B1 + 1.95, 0.45, 0.1)
  whoosh(B1 + 2.15, 1.0, 0.06)
  pop(B1 + 3.85, 0.14, 1500)
  whoosh(B3 - 0.4, 0.4, 0.12)
  // 3. tiles pop on eighths and count; the cursor reads the positions
  for (let i = 0; i < 6; i++) { pop(B3 + 0.17 + (i * SB) / 2, 0.2, 700 + i * 90); if (i < 4) ticks(B3 + 0.2 + (i * SB) / 2, B3 + 1.05 + (i * SB) / 2, 5, 0.03, 1400, 2000) }
  whoosh(B4 - 0.25, 0.45, 0.12)
  for (const d of [1.3, 1.75, 2.15]) click(B4 + d, 0.18)
  // 4. best and worst slam in; the win chimes, the loss lands low
  whoosh(B5 - 0.25, 0.4, 0.12)
  thump(B5 + 0.12, 0.3); thump(B5 + 0.28, 0.24)
  chime(B5 + 1.2, 0.32)
  pop(B5 + 1.36, 0.22, 330)
  click(B5 + 1.15, 0.16)
  // 5. end card: he lands, the logo pops, the url
  whoosh(B6 - 0.35, 0.45, 0.12)
  ;[0.42, 0.84, 1.3].forEach((d) => thump(B6 - 0.15 + d, 0.26))
  pop(B6 + 0.25, 0.28, 700)
  chime(B6 + 1.55, 0.3)
}
