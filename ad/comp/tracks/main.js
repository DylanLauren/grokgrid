// Main launch ad track: a modern phone-launch style beat (96 bpm, F C Dm Bb): hard drums, a gliding 808,
// bright keys and a chopped vocal-style hook. Bars land on the cuts.
setTempo(96)
// bars land on the cuts: the logo reveal (3.4 s) is a downbeat, and so is the end card (33.4 s)
const DROP = 3.4, BREAK = DROP + 10 * BAR, END_DROP = 33.4
const T0 = DROP - 2 * BAR
// F, C, D minor, B flat: one chord a bar, as midi notes (808 root, then the keys voicing)
const CHORDS = [[29, 60, 65, 69, 72], [36, 60, 64, 67, 71], [38, 62, 65, 69, 72], [34, 58, 62, 65, 69]]
const HOOK = [[0, 72, 1, 0], [2, 72, 1, 1], [3, 74, 2, 0], [6, 77, 2, 2], [10, 76, 1, 0], [11, 74, 1, 1], [12, 72, 3, 0],
  [16, 69, 1, 0], [18, 69, 1, 1], [19, 72, 2, 0], [22, 74, 2, 2], [26, 72, 1, 0], [27, 70, 1, 1], [28, 69, 4, 0]]
function hook(t, v = 0.07) { for (const [k, m, l, vw] of HOOK) chop(m, t + k * S16, l * S16 * 0.85, v, vw) }

// one bar of the main beat: kick pattern, snares on 2 and 4, 16th hats with a roll every other bar
const KICK = [0, 7, 10]
function beat(t, n, { full = true, lastBar = false } = {}) {
  for (const k of KICK) kick(t + k * S16, k ? 0.85 : 1)
  if (n % 2 === 1 && !lastBar) kick(t + 14 * S16, 0.6)
  snare(t + 4 * S16, 0.6); snare(t + 12 * S16, 0.62)
  for (let k = 0; k < 16; k++) {
    if (full && n % 2 === 1 && k >= 14) { hat(t + k * S16, 0.07); hat(t + k * S16 + S16 / 3, 0.05); hat(t + k * S16 + (2 * S16) / 3, 0.06) }
    else hat(t + k * S16, k % 4 === 2 ? 0.1 : k % 2 ? 0.045 : 0.07, full && k === 6)
    if (full) shaker(t + k * S16 + S16 * 0.1, k % 2 ? 0.04 : 0.025)
  }
  if (full) snap(t + 15 * S16, 0.12)
}
function bassLine(ch, t, n) {
  // the 808 follows the kicks, sliding into the bar from the last chord
  const prev = CHORDS[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 7 * S16, prev !== ch[0] ? prev : null)
  bass808(ch[0], t + 7 * S16, 3 * S16, null, 0.42)
  bass808(ch[0] + (n % 2 ? 12 : 7), t + 10 * S16, 6 * S16, ch[0], 0.45)
}

function music(seconds) {
  for (let n = 0; ; n++) {
    const t = T0 + n * BAR
    if (t >= seconds - 0.3) break
    const ch = CHORDS[n % 4]
    const intro = t < DROP - 0.01
    const main = !intro && t < BREAK - 0.01
    const brk = t >= BREAK - 0.01 && t < END_DROP - 0.01
    const fin = t >= END_DROP - 0.01
    if (intro) {
      // filtered keys, snaps and a shaker; the second bar builds
      if (t + BAR > 0) {
        keys(ch, t, false)
        for (let b = 0; b < 4; b++) if (b % 2 && t + b * BEAT > 0) snap(t + b * BEAT, 0.22)
        for (let k = 0; k < 16; k++) if (t + k * S16 > 0) shaker(t + k * S16, 0.03)
      }
      continue
    }
    pad(ch, t, BAR, main || fin ? 2600 : 1200)
    keys(ch, t, true)
    if (main || fin) {
      const last = n === Math.round((BREAK - T0) / BAR) - 1
      beat(t, n, { lastBar: last })
      bassLine(ch, t, n)
      // the hook comes in once he's on the phone, and plays over the end card
      const hn = n - Math.round((DROP - T0) / BAR)
      if ((hn >= 2 && hn % 2 === 0 && t + 2 * BAR <= BREAK + 0.01) || (fin && (n - Math.round((END_DROP - T0) / BAR)) % 2 === 0)) hook(t, fin ? 0.08 : 0.065)
      if (n % 4 === 0) crash(t, 0.1)
    }
    if (brk) {
      // the break: half-time, keys and the hook alone, then a roll back into the end card
      kick(t, 0.8)
      snare(t + 8 * S16, 0.45)
      for (let k = 0; k < 16; k += 2) hat(t + k * S16, 0.05)
      bass808(ch[0], t, BAR * 0.9, null, 0.35)
      if (t + BAR < END_DROP - 0.1) hook(t, 0.06)
    }
  }
  // a beat of silence before each drop, so it hits harder
  riser(0.3, DROP - BEAT * 0.25, 0.12)
  roll(DROP - BAR, DROP - BEAT * 0.25, 0.08, 0.35)
  crash(DROP, 0.22)
  riser(END_DROP - BAR * 1.5, END_DROP - BEAT * 0.25, 0.16)
  roll(END_DROP - BAR, END_DROP - BEAT * 0.25, 0.1, 0.5)
  crash(END_DROP, 0.26)
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

