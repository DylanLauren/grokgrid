import { open, mkdir, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { emptyTradingState, validateTradingState } from './trading-policy.mjs';
const digest = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

async function privateRegular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw Error('Journal file must be private and regular');
}
// Single writer; a crash leaves a lock requiring operator investigation. A stale
// lock is never silently removed while a transaction outcome might be unknown.
export async function withTradingStore(directory, policy, update) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Journal directory must be private');
  const lockPath = join(root, 'trading.lock'), file = join(root, 'trading-journal.json');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { const error=Error('Trading journal locked; inspect the existing worker before recovery'); error.code='TRADING_LOCKED'; throw error; }
  let tmp;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync();
    let state;
    try {
      await privateRegular(file);
      const envelope = JSON.parse(await readFile(file, 'utf8'));
      if (envelope.version !== 1 || envelope.sha256 !== digest(envelope.state)) throw Error('Trading journal checksum mismatch');
      state = validateTradingState(envelope.state, policy);
    } catch (e) { if (e?.code !== 'ENOENT') throw e; state = emptyTradingState(policy); }
    const next = validateTradingState(await update(structuredClone(state)), policy);
    if (next.revision < state.revision || (next.revision === state.revision && digest(next) !== digest(state))) throw Error('Trading journal revision must advance for changes');
    tmp = join(root, `.trading-${randomUUID()}.tmp`);
    const output = await open(tmp, 'wx', 0o600);
    try { await output.writeFile(JSON.stringify({ version: 1, state: next, sha256: digest(next) }, null, 2) + '\n'); await output.sync(); } finally { await output.close(); }
    await rename(tmp, file); tmp = null;
    const dir = await open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    return next;
  } finally {
    if (tmp) await unlink(tmp).catch(() => {});
    await lock.close(); await unlink(lockPath);
  }
}
