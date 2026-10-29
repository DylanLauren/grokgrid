#!/usr/bin/env node
// Rotates the workers' launchd logs in runtime/logs: a log over 5 MB is copied to .1 (older ones
// shift to .2 and .3, the oldest is dropped) and then truncated in place, because launchd keeps
// the file open. Runs hourly (fun.grokgrid.log-rotate); needs no root, unlike newsyslog.
import { readdir, stat, copyFile, rename, truncate, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const MAX_BYTES = 5 * 1024 * 1024, KEEP = 3;

export async function rotate(dir, maxBytes = MAX_BYTES, keep = KEEP) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const rotated = [];
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.log'))) {
    const file = join(dir, name);
    if ((await stat(file)).size <= maxBytes) continue;
    await unlink(`${file}.${keep}`).catch(() => {});
    for (let i = keep - 1; i >= 1; i--) await rename(`${file}.${i}`, `${file}.${i + 1}`).catch(() => {});
    await copyFile(file, `${file}.1`);
    await truncate(file, 0);
    rotated.push(name);
  }
  return rotated;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime')), 'logs');
  rotate(dir).then(r => { if (r.length) console.log(`rotated ${r.join(', ')}`); }).catch(e => { console.error(`log rotate: ${String(e?.code || 'failed')}`); process.exit(1); });
}
