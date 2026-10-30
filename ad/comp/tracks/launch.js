// "Launch your own Grok Bot" track: 98 bpm, C major, uplifting and anthemic. C G Am F, one chord a bar,
// a stomp-clap beat with a bouncing 808, bright keys and its own rising chopped-vocal hook.
// Bars land on the cuts: 2.449 (UI), 7.347 (naming), 12.245 (build into launch), 14.694 (the launch drop),
// 17.143 (fees), 19.592 (end card).
setTempo(98)
const B1 = BAR, B3 = 3 * BAR, B5 = 5 * BAR, B6 = 6 * BAR, B8 = 8 * BAR
// C, G, A minor, F: 808 root, then the keys voicing
const PROG = [[36, 60, 64, 67, 72], [43, 59, 62, 67, 71], [45, 60, 64, 69, 72], [41, 60, 65, 69, 72]]
// the hook: a rising call over C and G, an answer over Am and F. [16th, midi, length in 16ths, vowel]
const LH = [[0, 67, 2, 0], [2, 72, 2, 1], [4, 74, 1, 0], [5, 76, 3, 2], [8, 74, 1, 0], [10, 72, 2, 1], [12, 74, 4, 0],
  [16, 76, 2, 0], [18, 79, 2, 2], [20, 76, 1, 0], [21, 74, 1, 1], [22, 72, 2, 0], [24, 69, 2, 1], [26, 72, 1, 0], [27, 74, 5, 2]]
function lhook(t, v = 0.07, oct = 0) { for (const [k, m, l, vw] of LH) chop(m + oct, t + k * S16, l * S16 * 0.9, v, vw) }

// kick on 1, the and of 2, 3 and the a of 3; snare + clap stacked on 2 and 4; 8th hats with open hats on the offbeat
const KK = [0, 6, 8, 11]
function groove(t, n, { big = false, fillEnd = false } = {}) {
  for (const k of KK) kick(t + k * S16, k === 0 || k === 8 ? 1 : 0.8)
  snare(t + 4 * S16, big ? 0.66 : 0.58); clap(t + 4 * S16 + 0.01, 0.4)
  if (!fillEnd) { snare(t + 12 * S16, big ? 0.68 : 0.6); clap(t + 12 * S16 + 0.01, 0.42) }
  for (let k = 0; k < 16; k++) {
    if (fillEnd && k >= 12) continue
    if (k % 4 === 2) hat(t + k * S16, 0.08, true)
    else if (n % 2 === 1 && k >= 13) { hat(t + k * S16, 0.06); hat(t + k * S16 + S16 / 2, 0.05) }
    else hat(t + k * S16, k % 2 ? 0.04 : 0.065)
    shaker(t + k * S16 + S16 * 0.12, k % 2 ? 0.035 : 0.02)
  }
}
function bounce(ch, t, n) {
  const prev = PROG[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 5 * S16, prev !== ch[0] ? prev : null, 0.5)
  bass808(ch[0], t + 6 * S16, 2 * S16, null, 0.42)
  bass808(ch[0], t + 8 * S16, 3 * S16, null, 0.46)
  bass808(ch[0] + 12, t + 11 * S16, 3 * S16, ch[0], 0.4)
  bass808(ch[0] + 7, t + 14 * S16, 2 * S16, null, 0.36)
}
// anthem stabs: on the beat and its upbeat, a lift into the next bar
const STABS = [0, 3, 6, 8, 11, 14]

function music(seconds) {
  for (let n = 0; ; n++) {
    const t = n * BAR
    if (t >= seconds - 0.3) break
    const ch = PROG[n % 4]
    if (n === 0) {
      // the hook straight away over open keys and claps; the bar ends in a roll and a breath
      keys(ch, t, true, STABS)
      pad(ch, t, BAR, 1800)
      lhook(t, 0.075)
      for (const b of [1, 3]) clap(t + b * BEAT, 0.35)
      for (let k = 0; k < 12; k++) hat(t + k * S16, k % 2 ? 0.03 : 0.05)
      bass808(ch[0], t + 0.02, 6 * S16, null, 0.35)
      continue
    }
    if (n < 5) {
      // verse: full groove under the UI, hook every other bar pair
      keys(ch, t, n >= 3, STABS)
      pad(ch, t, BAR, 2200)
      groove(t, n, { fillEnd: n === 2 })
      bounce(ch, t, n)
      if (n === 3) lhook(t, 0.06)
      if (n === 1) { for (let k = 0; k < 4; k++) voice(ch[4] + 12, t + (8 + k) * S16, S16 * 0.7, { type: 'triangle', v: 0.03, cut: 6000, send: 0.3 }) }
      continue
    }
    if (n === 5) {
      // the build into the launch: four-on-the-floor stomps, rising filter, roll, then a breath
      keys(ch, t, false, [0, 2, 4, 6, 8, 10, 12, 14])
      pad(ch, t, BAR, 900)
      for (let b = 0; b < 3; b++) kick(t + b * BEAT, 0.85)
      for (let k = 0; k < 12; k++) hat(t + k * S16, 0.04 + k * 0.004)
      bass808(ch[0], t, 3 * BEAT, null, 0.38)
      continue
    }
    // the launch drop and the end card: everything, the hook an octave up on top
    const big = n >= 6
    keys(ch, t, true, STABS)
    pad(ch, t, BAR, 3200)
    groove(t, n, { big })
    bounce(ch, t, n)
    if (n === 6 || n === 8) lhook(t, 0.075)
    if (n === 6 || n === 8) lhook(t, 0.03, 12)
    if (n % 2 === 0) crash(t, 0.16)
  }
  // drops: a riser and roll into each, a beat of silence before the launch
  riser(0.6, B1 - 0.03, 0.1)
  roll(B1 - BEAT, B1 - S16, 0.1, 0.38)
  crash(B1, 0.22)
  crash(B3, 0.14)
  riser(B5, B6 - BEAT * 0.3, 0.18)
  roll(B5 + 2 * BEAT, B6 - BEAT * 0.5, 0.1, 0.55)
  crash(B6, 0.28)
  crash(B8, 0.24)
}

function sfx() {
  const tUI = B1
  // the page lands, nine picker bots pop up the scale
  whoosh(tUI - 0.35, 0.35, 0.12)
  for (let i = 0; i < 9; i++) pop(tUI + 0.45 + i * 0.05, 0.07, 620 + i * 70)
  // Connect
  click(tUI + 0.85, 0.32)
  bell(tUI + 0.9, 1318.5, 0.12)
  // hovers: a soft blip as each bot does its move
  ;[1.3, 2.15, 3.0, 3.85].forEach((d, i) => { pop(tUI + d + 0.12, 0.12, 900 + i * 120); thump(tUI + d + 0.3, 0.08) })
  // pick blue
  click(tUI + 4.3, 0.35)
  pop(tUI + 4.33, 0.22, 1100)
  // camera glides to the form
  whoosh(B3 - 0.3, 0.45, 0.12)
  // typing: name, description, x
  const tName = B3 + 0.55, tDesc = B3 + 1.45, tX = 4 * BAR + 1.5
  for (let i = 0; i < 9; i++) click(tName + i * 0.07, 0.07 + (i % 3) * 0.015)
  for (let i = 0; i < 63; i += 2) click(tDesc + i * 0.026, 0.045)
  for (let i = 0; i < 25; i += 2) click(tX + i * 0.03, 0.045)
  pop(tName + 9 * 0.07 + 0.05, 0.12, 1300) // ticker filled
  // down to Launch
  whoosh(B5 - 0.3, 0.45, 0.12)
  const tGo = B5 + 0.95
  click(tGo, 0.4)
  for (let i = 0; i < 3; i++) pop(tGo + 0.48 + i * 0.36, 0.13, 900 + i * 180)
  // the launch: flash, rings, the coin
  thump(B6, 0.4)
  chime(B6 + 0.05, 0.42)
  for (let i = 0; i < 3; i++) thump(B6 + 0.25 + i * 0.22, 0.16)
  for (let i = 0; i < 18; i++) pop(B6 + 0.32 + (i % 9) * 0.02 + (i >= 9 ? 0.05 : 0), 0.04, 700 + (i % 9) * 110)
  pop(B6 + 1.15, 0.2, 1000)
  // fees: the streams, the two cards
  whoosh(B6 + BAR - 0.35, 0.4, 0.12)
  pop(B6 + BAR + 0.2, 0.22, 700)
  whoosh(B6 + BAR + 0.5, 0.6, 0.1)
  pop(B6 + BAR + 0.9, 0.2, 880)
  pop(B6 + BAR + 1.1, 0.2, 1040)
  // end card
  pop(B8 + 0.08, 0.28, 700)
  for (let i = 0; i < 9; i++) pop(B8 + 0.35 + i * 0.05, 0.06, 800 + i * 60)
  chime(B8 + 0.85, 0.32)
}
