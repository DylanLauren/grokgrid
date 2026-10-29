// "Every trade, called out" track: 104 bpm, E flat major (Eb, Gm, Ab, Bb), bright and snappy.
// A punchy one-bar intro under the hook shot, a drop when the Calls panel lands (bar 1), a lighter
// half-time bar pair under the posts, a roll and the last drop on the end card (bar 7).
setTempo(104)
const DROP = BAR, HALF = 5 * BAR, END_DROP = 7 * BAR
// Eb, Gm, Ab, Bb: 808 root, then the keys voicing (maj7 / m7 colours, kept high and bright)
const CHORDS = [[27, 63, 67, 70, 74], [31, 62, 65, 67, 70], [32, 63, 67, 68, 72], [34, 62, 65, 70, 72]]
// two-bar hook in E flat major pentatonic: [16th, midi, length in 16ths, vowel]
const HOOK = [[0, 79, 2, 0], [2, 82, 1, 1], [3, 79, 1, 0], [4, 77, 2, 2], [6, 75, 2, 0], [8, 77, 1, 1], [9, 79, 1, 0], [10, 82, 3, 2], [14, 84, 2, 0],
  [16, 82, 2, 0], [18, 79, 1, 1], [19, 77, 1, 0], [20, 75, 3, 2], [24, 77, 1, 0], [25, 79, 1, 1], [26, 77, 2, 0], [28, 75, 4, 2]]
function hookAt(t, v = 0.07, upTo = 32) { for (const [k, m, l, vw] of HOOK) if (k < upTo) chop(m, t + k * S16, l * S16 * 0.85, v, vw) }
// a plucked counter-line: 16th arpeggio of the chord, an octave up, through the echo
function pluck(ch, t, v = 0.03) {
  const ORD = [0, 2, 1, 3, 2, 1, 3, 2]
  for (let k = 0; k < 16; k += 2) voice(ch[1 + ORD[(k / 2) % 8]] + 12, t + k * S16, S16 * 0.5, { type: 'square', v, cut: 3800, rel: 0.08, pan: k % 4 ? 0.35 : -0.35, send: 0.3 })
}

// the beat: kick on 1, the "and" of 1, 3 and its 16th push; claps on 2 and 4; snaps as ghosts
const KICK = [0, 3, 8, 10]
function beat(t, n, { last = false } = {}) {
  for (const k of KICK) kick(t + k * S16, k === 0 || k === 8 ? 1 : 0.78)
  if (n % 2 === 1 && !last) kick(t + 15 * S16, 0.55)
  snare(t + 4 * S16, 0.6); snare(t + 12 * S16, 0.64)
  snap(t + 7 * S16, 0.1); if (!last) snap(t + 14 * S16, 0.09)
  for (let k = 0; k < 16; k++) {
    // a 32nd-note hat roll at the end of every second bar
    if (n % 2 === 1 && k >= 12 && !last) { hat(t + k * S16, 0.06 + (k - 12) * 0.01); hat(t + k * S16 + S16 / 2, 0.05 + (k - 12) * 0.01) }
    else hat(t + k * S16, k % 4 === 2 ? 0.1 : k % 2 ? 0.04 : 0.065, k === 10)
    shaker(t + k * S16 + S16 * 0.12, k % 2 ? 0.035 : 0.02)
  }
}
function bassLine(ch, t, n) {
  const prev = CHORDS[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 3 * S16, prev !== ch[0] ? prev : null, 0.5)
  bass808(ch[0], t + 3 * S16, 5 * S16, null, 0.44)
  bass808(ch[0], t + 8 * S16, 2 * S16, null, 0.46)
  bass808(ch[0] + 12, t + 10 * S16, 3 * S16, ch[0], 0.4)
  bass808(ch[0] + (n % 2 ? 10 : 7), t + 13 * S16, 3 * S16, ch[0] + 12, 0.38)
}

function music(seconds) {
  for (let n = 0; ; n++) {
    const t = n * BAR
    if (t >= seconds - 0.3) break
    const ch = CHORDS[n % 4]
    const intro = n === 0
    const main = n >= 1 && n < 5
    const half = n >= 5 && n < 7
    const fin = n >= 7
    if (intro) {
      // the hook shot: a kick on one, stabs on the Buy / Sell tags, filtered keys, then a riser
      kick(0.02, 1); crash(0.02, 0.14)
      keys(ch, t, false, [0, 3, 6, 8, 11])
      for (const b of [4, 6, 8, 10]) { clap(t + b * S16, 0.32); kick(t + b * S16, 0.55) }
      for (let k = 0; k < 12; k++) hat(t + k * S16, k % 2 ? 0.04 : 0.06)
      hookAt(t, 0.04, 12)
      continue
    }
    pad(ch, t, BAR, half ? 1500 : 2800)
    keys(ch, t, true, [0, 3, 6, 8, 11, 14])
    if (main || fin) {
      beat(t, n, { last: n === 4 && false })
      bassLine(ch, t, n)
      if ((n - 1) % 2 === 0) hookAt(t, fin ? 0.08 : 0.068)
      if (n >= 3 && main) pluck(ch, t, 0.022)
      if (fin) pluck(ch, t, 0.02)
      if ((n - 1) % 2 === 0) crash(t, 0.1)
    }
    if (half) {
      // half-time under the posts: kick on one, a big clap on three, the hook alone, an 8th-note hat
      kick(t, 0.9); kick(t + 10 * S16, 0.6)
      snare(t + 8 * S16, 0.62)
      for (let k = 0; k < 16; k += 2) hat(t + k * S16, k % 4 ? 0.04 : 0.06)
      bass808(ch[0], t, BAR * 0.85, null, 0.38)
      if (n === 5) hookAt(t, 0.062)
      else pluck(ch, t, 0.024)
    }
  }
  // a beat of near silence before each drop, so it hits
  riser(0.6, DROP - BEAT * 0.25, 0.12)
  roll(DROP - BEAT * 1.5, DROP - BEAT * 0.25, 0.1, 0.35)
  crash(DROP, 0.22)
  riser(END_DROP - BAR, END_DROP - BEAT * 0.25, 0.16)
  roll(END_DROP - BAR * 0.5, END_DROP - BEAT * 0.25, 0.1, 0.5)
  crash(END_DROP, 0.26)
}

function sfx() {
  const B = BEAT
  // 1. hook: the face, the four tags
  thump(0.05, 0.3)
  ;[0.58, 0.865, 1.15, 1.44].forEach((t, i) => pop(t, 0.2, 760 + i * 120))
  whoosh(DROP - 0.45, 0.4)
  // 2. the panel slides in, older calls tick in, three new calls land on top
  whoosh(DROP + 0.02, 0.45, 0.12)
  for (let i = 0; i < 6; i++) pop(DROP + 0.3 + i * 0.07, 0.05, 1300 + i * 70)
  ;[2 * BAR - 2 * B, 2 * BAR - B, 2 * BAR].forEach((t, i) => { thump(t, 0.22 + i * 0.05); pop(t + 0.06, 0.18, 900 + i * 150) })
  whoosh(3 * BAR - 0.55, 0.5, 0.12)
  // 3. inside the card: labels on the beat, the click on "check tx", the red one
  ;[0, 1, 2, 3].forEach((i) => pop(3 * BAR + 0.5 + i * B, 0.14, 1100 + i * 90))
  whoosh(4 * BAR + 0.05, 0.4, 0.08)
  click(4 * BAR + 0.75, 0.38)
  chime(4 * BAR + 0.82, 0.3)
  whoosh(4 * BAR + 1.15, 0.5, 0.08)
  pop(4 * BAR + 1.85, 0.14, 620)
  // 4. the posts: each card lands, its text types, its tag pops
  whoosh(HALF + 0.2, 0.45)
  thump(HALF + 0.5, 0.22)
  for (let i = 0; i < 28; i++) click(HALF + 0.75 + i * 0.056, 0.05)
  pop(HALF + 0.9, 0.16, 980)
  whoosh(6 * BAR - 0.15, 0.45)
  thump(6 * BAR + 0.2, 0.22)
  for (let i = 0; i < 22; i++) click(6 * BAR + 0.45 + i * 0.056, 0.05)
  pop(6 * BAR + 0.6, 0.16, 1080)
  // 5. end card: he hops in, the logo, the tags, the pill
  ;[0.42, 0.84, 1.26].forEach((d) => thump(END_DROP + d, 0.2))
  pop(END_DROP + 0.2, 0.26, 700)
  pop(END_DROP + 1.15, 0.18, 900); pop(END_DROP + 1.44, 0.18, 1040)
  chime(END_DROP + 1.35, 0.32)
}
