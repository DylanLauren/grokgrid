// The matrix feature track: 110 bpm, D minor (Dm Gm Bb A), driving four-on-the-floor-ish kick with
// a syncopated push, 16th hats with rolls, a bouncing 808, a 16th pluck arp and its own chopped hook.
setTempo(110)
const BR = (n) => n * BAR
const DROP = BR(1), BREAK = BR(7), END = BR(8)
const CLICK_T = BR(3) + 2 * BEAT
// Dm, Gm, B flat, A: 808 root, then voicing
const CH = [[38, 62, 65, 69, 74], [31, 62, 67, 70, 74], [34, 62, 65, 70, 74], [33, 61, 64, 69, 73]]
// four-bar hook: [16th, midi, length in 16ths, vowel]
const HOOK = [
  [0, 74, 1, 0], [2, 74, 1, 1], [3, 77, 2, 0], [6, 74, 1, 1], [8, 81, 2, 2], [11, 77, 1, 0], [12, 76, 2, 1], [14, 74, 2, 0],
  [16, 74, 1, 0], [18, 74, 1, 1], [19, 77, 2, 0], [22, 79, 2, 2], [25, 77, 1, 0], [26, 74, 2, 1], [28, 70, 4, 0],
  [32, 74, 1, 0], [34, 74, 1, 1], [35, 77, 2, 0], [38, 74, 1, 1], [40, 81, 2, 2], [43, 79, 1, 0], [44, 77, 2, 1], [46, 74, 2, 0],
  [48, 76, 1, 0], [50, 76, 1, 1], [51, 73, 2, 0], [54, 76, 2, 2], [57, 73, 1, 0], [58, 69, 2, 1], [60, 64, 2, 0], [62, 69, 2, 2],
]
function hookBar(t, bar, v = 0.07) { for (const [k, m, l, vw] of HOOK) if (k >= bar * 16 && k < bar * 16 + 16) chop(m, t + (k - bar * 16) * S16, l * S16 * 0.85, v, vw) }

// kick: 1, the "and" of 2, 3, and a push on the last 16th of 3
const KICK = [0, 6, 8, 11]
function drums(t, n, last = false) {
  for (const k of KICK) kick(t + k * S16, k === 0 ? 1 : k === 11 ? 0.7 : 0.88)
  if (n % 2 && !last) kick(t + 14 * S16, 0.65)
  snare(t + 4 * S16, 0.62); snare(t + 12 * S16, 0.64)
  clap(t + 12 * S16 + 0.01, 0.25)
  for (let k = 0; k < 16; k++) {
    if (n % 2 === 1 && k >= 12 && k < 14) { for (let j = 0; j < 4; j++) hat(t + k * S16 + j * S16 / 4, 0.04 + j * 0.01) }
    else hat(t + k * S16, k % 4 === 2 ? 0.11 : k % 2 ? 0.05 : 0.075, k === 14)
    shaker(t + k * S16 + S16 * 0.12, k % 2 ? 0.035 : 0.02)
  }
  snap(t + 7 * S16, 0.1)
}
function bass(ch, t, n) {
  const prev = CH[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 6 * S16, prev !== ch[0] ? prev : null, 0.5)
  bass808(ch[0] + 12, t + 6 * S16, 2 * S16, ch[0], 0.4)
  bass808(ch[0], t + 8 * S16, 3 * S16, null, 0.45)
  bass808(ch[0] + 7, t + 11 * S16, 5 * S16, ch[0], 0.42)
}
// 16th pluck arp up and down the chord
function arp(ch, t, open) {
  const notes = [ch[1], ch[2], ch[3], ch[4], ch[3] + 12, ch[4], ch[3], ch[2]]
  for (let k = 0; k < 16; k++) {
    const m = notes[k % 8] + (k >= 8 ? 0 : 0)
    voice(m, t + k * S16, S16 * 0.5, { type: 'sawtooth', v: k % 4 === 0 ? 0.03 : 0.022, cut: open ? 3800 : 900, cutEnd: open ? 900 : 500, rel: 0.08, pan: k % 2 ? 0.35 : -0.35, send: 0.18 })
  }
}

function music(seconds) {
  // bar 0: the hook frame. A hit on the downbeat, a filtered arp, shakers, a roll into the drop
  kick(0.02, 1); crash(0.02, 0.18); bass808(38, 0.02, BEAT * 1.5, 50, 0.5)
  arp(CH[0], 0, false)
  pad(CH[0], 0, BAR, 900)
  for (let k = 4; k < 16; k++) shaker(k * S16, 0.03)
  for (let b = 1; b < 3; b++) snap(b * BEAT + BEAT / 2, 0.18)
  riser(0.4, DROP - BEAT * 0.25, 0.14)
  roll(BEAT * 2, DROP - BEAT * 0.25, 0.08, 0.38)
  for (let n = 1; ; n++) {
    const t = BR(n)
    if (t >= seconds - 0.2) break
    const ch = CH[(n - 1) % 4]
    if (n < 7 || n >= 8) {
      const last = n === 6
      pad(ch, t, BAR, 2600)
      arp(ch, t, true)
      drums(t, n, last)
      bass(ch, t, n)
      // the hook: bars 1-4 once through, again over the closing line and the end card
      const hb = n >= 8 ? (n - 8) % 4 : (n - 1) % 4
      if (n <= 4 || n === 6 || n >= 8) hookBar(t, n === 6 ? 0 : hb, n >= 8 ? 0.08 : 0.068)
      if (n === 5) keys(ch, t, true, [0, 3, 6, 10, 12])
      if ((n - 1) % 2 === 0 || n === 6) crash(t, 0.1)
    } else {
      // bar 7, the break: half time, the family runs, a roll back in
      pad(ch, t, BAR, 1500)
      arp(ch, t, false)
      kick(t, 0.9); snare(t + 8 * S16, 0.5)
      for (let k = 0; k < 16; k += 2) hat(t + k * S16, 0.05)
      bass808(ch[0], t, BAR * 0.45, null, 0.4)
      hookBar(t, 2, 0.06)
    }
  }
  // the sort lands on a big snare + crash
  crash(CLICK_T, 0.14)
  riser(END - BAR, END - BEAT * 0.25, 0.16)
  roll(END - BEAT * 2, END - BEAT * 0.25, 0.12, 0.5)
  crash(END, 0.26)
  crash(DROP, 0.22)
}

function sfx() {
  // the wall pops out from the centre
  for (let i = 0; i < 28; i++) pop(0.03 + i * 0.022, 0.05, 700 + (i % 7) * 110)
  thump(0.3, 0.2)
  whoosh(1.75, 0.45, 0.2)
  // page: title, totals counting, rows streaming in
  whoosh(DROP - 0.05, 0.4, 0.1)
  for (let i = 0; i < 12; i++) click(DROP + 1.0 + i * 0.09, 0.08)
  for (let p = 0; p < 10; p++) pop(DROP + 1.6 + p * 0.17, 0.12, 900 + p * 40)
  // the click and the sort
  click(CLICK_T, 0.4)
  whoosh(CLICK_T + 0.05, 0.75, 0.14)
  for (let i = 0; i < 10; i++) thump(CLICK_T + 0.25 + i * 0.045, 0.08)
  // live numbers flash during the glide
  ;[0.6, 1.2, 1.7, 2.3, 2.9, 3.3].forEach((d) => pop(BR(5) + d, 0.1, 1500))
  whoosh(BR(5) - 0.2, 0.6, 0.1)
  whoosh(BR(6) - 0.1, 0.8, 0.14)
  whoosh(BREAK - 0.3, 0.4, 0.14)
  for (let i = 0; i < 6; i++) thump(BREAK + 0.2 + i * 0.36, 0.12)
  // end card
  thump(END + 0.3, 0.3)
  pop(END + 0.6, 0.3, 700)
  pop(END + 1.5, 0.28, 880)
  chime(END + 1.85, 0.4)
}
