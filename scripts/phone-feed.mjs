#!/usr/bin/env node
// Sends Grok Bot's real phone screen to the site, free, about one frame every 2 seconds.
// Runs on Grok Bot's Mac next to his phone window (iPhone Mirroring, an Android emulator,
// or a phone-sized browser on pump.fun). Needs Node 18+ and nothing else.
//
//   INGEST_TOKEN=... node scripts/phone-feed.mjs --rect 100,80,390,844
//
// --rect x,y,w,h   the phone window on screen, in points (Cmd+Shift+4 shows them)
// --every 2        seconds between frames
// --site URL       defaults to https://grokgrid-alpha.vercel.app
// The token is read from the environment and never written anywhere.
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const TOKEN = process.env.INGEST_TOKEN
const SITE = arg('site', 'https://grokgrid-alpha.vercel.app').replace(/\/$/, '')
const RECT = arg('rect', '')
const EVERY = Math.max(1.5, Number(arg('every', 2))) * 1000
if (!TOKEN) throw new Error('set INGEST_TOKEN in the environment')
if (!/^\d+,\d+,\d+,\d+$/.test(RECT)) throw new Error('pass --rect x,y,w,h of the phone window')

const shot = join(tmpdir(), 'gg-phone.jpg')

// macOS screencapture grabs the rect, sips shrinks it to phone width and squeezes the JPEG.
async function frame() {
  await run('screencapture', ['-x', '-t', 'jpg', '-R', RECT, shot])
  await run('sips', ['--resampleWidth', '390', '-s', 'formatOptions', '70', shot])
  const jpeg = (await readFile(shot)).toString('base64')
  await rm(shot, { force: true })
  return jpeg
}

async function send(jpeg) {
  const res = await fetch(`${SITE}/api/ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'screen', jpeg }),
  })
  if (!res.ok) throw new Error(`ingest ${res.status}`)
}

let fails = 0
for (;;) {
  const started = Date.now()
  try {
    await send(await frame())
    if (fails) console.log('sending again')
    fails = 0
  } catch (e) {
    if (fails++ % 10 === 0) console.error(String(e.message || e))
  }
  await new Promise((r) => setTimeout(r, Math.max(0, EVERY - (Date.now() - started))))
}
