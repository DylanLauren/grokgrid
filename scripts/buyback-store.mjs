import { open, mkdir, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { emptyBuybackState, validateBuybackState } from './buyback-policy.mjs';
const digest = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

async function privateRegular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw Error('Buyback journal must be private and regular');
}

async function write(root, file, state) {
  const tmp = join(root, `.buyback-${randomUUID()}.tmp`);
  try {
    const output = await open(tmp, 'wx', 0o600);
    try { await output.writeFile(JSON.stringify({ version: 1, state, sha256: digest(state) }, null, 2) + '\n'); await output.sync(); } finally { await output.close(); }
    await rename(tmp, file);
    const dir = await open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
}

// Same single-writer rules as the trading journal: a crash leaves the lock for an operator.
// `run` gets a `commit(next)` that durably persists before returning, so callers can
// write a signed-but-unsent cycle and only then broadcast it.
export async function withBuybackStore(directory, config, run) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Buyback journal directory must be private');
  const lockPath = join(root, 'buyback.lock'), file = join(root, 'buyback-journal.json');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { const error = Error('Buyback journal locked; inspect the existing worker before recovery'); error.code = 'BUYBACK_LOCKED'; throw error; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await lock.sync();
    let state;
    try {
      await privateRegular(file);
      const envelope = JSON.parse(await readFile(file, 'utf8'));
      if (envelope.version !== 1 || envelope.sha256 !== digest(envelope.state)) throw Error('Buyback journal checksum mismatch');
      state = validateBuybackState(envelope.state, config);
    } catch (e) { if (e?.code !== 'ENOENT') throw e; state = emptyBuybackState(config); }
    const commit = async next => {
      validateBuybackState(next, config);
      if (next.revision < state.revision || (next.revision === state.revision && digest(next) !== digest(state))) throw Error('Buyback journal revision must advance for changes');
      if (next.revision !== state.revision) await write(root, file, next);
      state = next;
      return state;
    };
    await run(state, commit);
    return state;
  } finally {
    await lock.close(); await unlink(lockPath);
  }
}
