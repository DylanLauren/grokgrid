#!/usr/bin/env node
// Deliberately no keypair loading, transaction building, signing, or broadcasting.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { fundState, validateRuntime } from './runtime-policy.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const cfg = JSON.parse(await readFile(join(root, 'observer-config.json'), 'utf8'));
const origin = 'https://grokgrid-alpha.vercel.app';
const tokenFile = resolve(cfg.tokenFile);
const conn = new Connection(cfg.rpcUrl, { commitment: 'finalized', disableRetryOnRateLimit: true, confirmTransactionInitialTimeout: 15000,
  fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000), redirect: 'error' }) });
await mkdir(root, { recursive: true, mode: 0o700 });
const stateFile = join(root, 'observer-status.json');
let previous;
try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch {}
let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });

async function get(path, token) {
  const r = await fetch(origin + path, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Error(`Control plane ${r.status}`);
  return r.json();
}
async function save(value) {
  await writeFile(stateFile + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(stateFile + '.tmp', stateFile);
}
async function tick() {
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const config = validateRuntime(await get('/api/runtime', token), cfg.houseWallet, cfg.burnWallet);
  const [accounts, queue] = await Promise.all([
    conn.getMultipleAccountsInfo([new PublicKey(config.houseWallet), new PublicKey(config.burnWallet)], 'finalized'), get('/api/ingest', token),
  ]);
  let mintVerified = false;
  if (config.officialMint) {
    const mintKey = new PublicKey(config.officialMint), account = await conn.getAccountInfo(mintKey, 'finalized');
    if (account && [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58())) {
      const mint = await getMint(conn, mintKey, 'finalized', account.owner);
      mintVerified = mint.isInitialized && mint.mintAuthority === null && mint.freezeAuthority === null;
    }
  }
  const safeBalance = a => { const n = a?.lamports ?? 0; if (!Number.isSafeInteger(n) || n < 0) throw Error('Unsafe balance'); return String(n); };
  const burn = fundState({ balanceLamports: safeBalance(accounts[1]), previousLamports: previous?.burn?.balanceLamports,
    mint: config.officialMint, mintVerified, reserveLamports: cfg.reserveLamports, thresholdLamports: cfg.thresholdLamports });
  const result = { observedAt: new Date().toISOString(), status: 'observing', mode: 'observe-only', signingEnabled: false,
    house: { wallet: config.houseWallet, balanceLamports: safeBalance(accounts[0]) }, burn: { wallet: config.burnWallet, ...burn },
    officialMint: config.officialMint || null, mintVerified, freeWallets: queue.free,
    pendingLaunches: Array.isArray(queue.launches) ? queue.launches : [],
    strategy: 'unvalidated-no-orders', executionEnabled: false };
  await save(result); previous = result;
  console.log(JSON.stringify({ at: result.observedAt, status: result.status, burnState: burn.state, queued: result.pendingLaunches.length }));
}
do {
  try { await tick(); } catch {
    // Never serialize network exceptions: provider URLs may contain API secrets.
    await save({ observedAt: new Date().toISOString(), status: 'unavailable', signingEnabled: false, executionEnabled: false });
    console.error('Observer unavailable; no action taken.');
    if (process.argv.includes('--once')) process.exitCode = 1;
  }
  if (process.argv.includes('--once') || stop) break;
  await new Promise(r => setTimeout(r, 30000));
} while (!stop);
