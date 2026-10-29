// "Watch him trade, live": a bouncy, bright A minor beat at 100 bpm (Am F C G). Swung 16th hats, a skippy kick,
// offbeat keys, a gliding 808 and a plucked square-wave hook with a vocal chop answer. One bar = 2.4 s, so the
// cuts at 2.4 (his room), 9.6 (his phone), 14.4 (room or phone) and 16.8 (end card) all land on downbeats.
setTempo(100)
const ROOM = 2.4, BUILD = 7.2, PHONE = 9.6, PICK = 14.4, END = 16.8
// Am(add9), Fmaj7, C, G: 808 root first, then the keys voicing
const CHORDS = [[33, 60, 64, 67, 71], [29, 60, 64, 65, 69], [36, 60, 64, 67, 72], [31, 59, 62, 67, 71]]
const SW = 0.14 // swing on the off 16ths
const at16 = (t, k) => t + k * S16 + (k % 2 ? SW * S16 : 0)
// the hook: two bars in A minor pentatonic [16th, midi, length in 16ths]
const HOOK = [[0, 76, 2], [2, 76, 1], [3, 79, 2], [6, 76, 1], [8, 74, 2], [10, 72, 2], [12, 74, 1], [14, 76, 2],
  [16, 81, 2], [18, 79, 1], [19, 76, 2], [22, 74, 1], [24, 72, 2], [26, 74, 2], [28, 69, 3]]
function pluck(m, t, len, v) {
  voice(m, t, len, { type: 'square', v, cut: 4200, cutEnd: 900, q: 2, a: 0.003, rel: 0.14, detune: [-6, 6], send: 0.3, verb: 0.15 })
  voice(m + 12, t, len * 0.5, { type: 'sine', v: v * 0.45, cut: 9000, rel: 0.2, send: 0.2 })
}
function hook(t, v = 0.05, half = 0) {
  for (const [k, m, l] of HOOK) {
    if (half === 1 && k >= 16) continue
    pluck(m, at16(t, k), l * S16 * 0.8, v)
  }
}
// a vocal chop answer on the last beat of the second hook bar
function answer(t, v = 0.06) {
  chop(81, at16(t, 29), S16 * 0.8, v, 1)
  chop(79, at16(t, 30), S16 * 0.8, v, 0)
  chop(76, at16(t, 31), S16 * 1.6, v, 2)
}
const KICK = [0, 6, 8, 11]
function beat(t, n, { fill = false } = {}) {
  for (const k of KICK) kick(at16(t, k), k === 0 ? 1 : k === 8 ? 0.9 : 0.75)
  if (n % 2 === 1 && !fill) kick(at16(t, 15), 0.55)
  snare(t + 4 * S16, 0.58); snare(t + 12 * S16, 0.62); clap(t + 12 * S16 + 0.01, 0.35)
  for (let k = 0; k < 16; k++) {
    if (n % 2 === 1 && (k === 7 || k === 15) && !fill) { for (let r = 0; r < 3; r++) hat(at16(t, k) + (r * S16) / 3, 0.05 + r * 0.01) }
    else hat(at16(t, k), k % 4 === 2 ? 0.1 : k % 2 ? 0.04 : 0.065, k === 14 && n % 2 === 0)
    if (k % 2 === 0) shaker(at16(t, k) + S16 * 0.1, 0.03)
  }
  if (!fill) { snap(at16(t, 7), 0.1); snap(at16(t, 15), 0.12) }
}
function bassLine(ch, t, n) {
  const prev = CHORDS[(((n - 1) % 4) + 4) % 4][0]
  bass808(ch[0], t, 6 * S16, prev !== ch[0] ? prev : null, 0.5)
  bass808(ch[0], at16(t, 6), 2 * S16, null, 0.4)
  bass808(ch[0] + 12, at16(t, 8), 3 * S16, ch[0], 0.42)
  bass808(ch[0], at16(t, 11), 5 * S16, null, 0.42)
}

function music(seconds) {
  for (let n = 0; ; n++) {
    const t = n * BAR
    if (t >= seconds - 0.3) break
    const ch = CHORDS[n % 4]
    const intro = t < ROOM - 0.01
    const build = t >= BUILD - 0.01 && t < PHONE - 0.01
    const preEnd = t >= PICK - 0.01 && t < END - 0.01
    const fin = t >= END - 0.01
    if (intro) {
      // the hook right away, filtered keys and snaps: the hook is the first thing you hear
      keys(ch, t, false, [2, 6, 10, 14])
      for (let b = 0; b < 4; b++) snap(t + b * BEAT + BEAT / 2, 0.16)
      for (let k = 0; k < 16; k += 2) shaker(at16(t, k), 0.025)
      hook(t + 0.0, 0.04, 1)
      continue
    }
    pad(ch, t, BAR, build ? 1400 : 2800)
    keys(ch, t, !build, [2, 6, 10, 14])
    if (build) {
      // the build: half-time kick, the 808 drops out, a roll and a riser into his phone
      kick(t, 0.85); kick(t + 8 * S16, 0.7)
      for (let k = 0; k < 16; k += 2) hat(at16(t, k), 0.05)
      bass808(ch[0], t, BAR * 0.5, null, 0.35)
      continue
    }
    beat(t, n, { fill: preEnd })
    bassLine(ch, t, n)
    // the hook every two bars from the second bar of the room, louder after the drop
    const hn = n - 1
    if (hn % 2 === 0 && t + 2 * BAR <= BUILD + 0.01) hook(t, 0.045)
    if (t >= PHONE - 0.01 && t < PICK - 0.01 && (n - PHONE / BAR) % 2 === 0) { hook(t, 0.055); answer(t, 0.06) }
    if (preEnd) hook(t, 0.05, 1)
    if (fin && (n - END / BAR) % 2 === 0) { hook(t, 0.055); answer(t, 0.055) }
    if (n % 2 === 1) crash(t, 0.08)
  }
  // risers, rolls and a breath of silence before each drop
  riser(0.6, ROOM - BEAT * 0.25, 0.1)
  crash(ROOM, 0.2)
  riser(BUILD, PHONE - BEAT * 0.25, 0.18)
  roll(PHONE - BAR * 0.75, PHONE - BEAT * 0.25, 0.08, 0.5)
  crash(PHONE, 0.26)
  crash(PICK, 0.14)
  roll(END - BEAT, END - BEAT * 0.25, 0.12, 0.45)
  crash(END, 0.24)
}

function sfx() {
  // timed to cuts/desk.js
  thump(0.34, 0.24); thump(0.8, 0.28)
  pop(1.27, 0.24, 980)
  whoosh(2.05, 0.4)
  for (let i = 0; i < 6; i++) pop(2.72 + i * 0.06, 0.06, 900 + i * 80)
  pop(3.12, 0.16, 700); pop(3.26, 0.14, 760)
  for (let i = 0; i < 10; i++) click(3.4 + i * 0.11, 0.07)
  pop(3.62, 0.22, 820)
  pop(4.32, 0.24, 1050)
  whoosh(4.85, 0.6, 0.12)
  pop(6.0, 0.1, 1400)
  whoosh(6.85, 0.5)
  click(8.4, 0.4); pop(8.42, 0.18, 1200)
  whoosh(9.05, 0.55, 0.2)
  pop(10.02, 0.18, 900)
  pop(10.82, 0.24, 900); click(10.8, 0.15)
  chime(12.0, 0.5)
  pop(12.62, 0.2, 1000)
  whoosh(14.05, 0.45)
  pop(14.52, 0.16, 700); pop(14.64, 0.16, 780)
  pop(14.78, 0.2, 900)
  ;[15.0, 15.6, 16.2].forEach((c) => click(c, 0.22))
  whoosh(16.45, 0.4)
  thump(17.22, 0.22); thump(17.64, 0.24)
  pop(17.37, 0.28, 700)
  pop(18.22, 0.22, 980)
  chime(18.55, 0.35)
}
