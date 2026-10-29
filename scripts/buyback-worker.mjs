#!/usr/bin/env node
// $GRID buy-and-burn worker, one tick per run (launchd runs it on an interval).
// Ships off: with the default config it only reads the chain and writes a status file.
// When dlao turns it on, each cycle buys $GRID with the burn wallet's spare SOL and burns
// every token it holds with an SPL BurnChecked. Signatures are journaled before broadcast.
import { open, rename, mkdir, lstat, unlink, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { validateBuybackConfig, executionBlockers, plannedSpend, openCycle, recordBuy, settleLeg, recordBurn, closeEmpty } from './buyback-policy.mjs';
import { withBuybackStore } from './buyback-store.mjs';
import { connect, readMint, readWallet, signatureStatus, buildBuy, buildBurn, loadSigner, signedSignature } from './buyback-chain.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const args = process.argv.slice(2);
if (args.some(x => x !== '--once')) { console.error('Usage: buyback-worker.mjs [--once]'); process.exit(1); }
const ownedPrivate = s => (!process.getuid || s.uid === process.getuid()) && (s.mode & 0o077) === 0;

async function json(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await handle.stat(); if (!s.isFile() || !ownedPrivate(s) || s.size > 1024 * 1024) throw Error('Runtime input must be private and owned');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function savePrivate(name, value) {
  const tmp = join(root, `.${name}.${randomUUID()}.tmp`); let handle;
  try { handle = await open(tmp, 'wx', 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null; await rename(tmp, join(root, name)); }
  finally { if (handle) await handle.close(); await unlink(tmp).catch(() => {}); }
}
const exists = path => access(path).then(() => true, () => false);

async function tick() {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !ownedPrivate(rootStat)) throw Error('Runtime directory must be private and owned');
  const config = validateBuybackConfig(await json(join(root, 'buyback-config.json')));
  const rpc = await json(join(root, 'observer-config.json'));
  if (rpc.burnWallet !== config.burnWallet) throw Error('Observer and buyback disagree on the burn wallet');
  const conn = connect(rpc.rpcUrl);

  const stopFilePresent = await exists(config.stopFile);
  const mint = config.officialMint ? await readMint(conn, config.officialMint) : { verified: false };
  let wallet = await readWallet(conn, config.burnWallet, config.officialMint, mint.tokenProgram);
  let keypairMatches = false, signer = null;
  const gates = { stopFilePresent, mintVerified: mint.verified, observedMint: config.officialMint, keypairMatches };
  if (config.signingEnabled && executionBlockers(config, { ...gates, keypairMatches: true }).length === 0) {
    signer = await loadSigner(config.keypairFile, config.burnWallet); keypairMatches = true;
  }
  const blockers = executionBlockers(config, { ...gates, keypairMatches });
  const live = blockers.length === 0 && signer !== null;
  let action = 'none', detail = null;

  const send = async tx => {
    // The cycle is already durable. A send error leaves it pending; expiry settles it later.
    try { await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 }); }
    catch { detail = 'broadcast-error-held'; }
  };

  const state = await withBuybackStore(join(root, 'buyback'), config, async (s, commit) => {
    const open = openCycle(s);
    if (open && (open.state === 'buy-pending' || open.state === 'burn-pending')) {
      const leg = open.state === 'buy-pending' ? 'buy' : 'burn';
      const next = settleLeg(s, config, open.id, leg, await signatureStatus(conn, open[leg].signature), wallet.blockHeight);
      await commit(next); action = next === s ? `${leg}-held-awaiting-finality` : `${leg}-settled`;
      return;
    }
    if (open && open.state === 'buy-finalized') {
      wallet = await readWallet(conn, config.burnWallet, open.mint, mint.tokenProgram);
      if (BigInt(wallet.tokenUnits) === 0n) { await commit(closeEmpty(s, config, open.id)); action = 'closed-nothing-to-burn'; return; }
      if (!live) { action = 'burn-ready-execution-blocked'; return; }
      const built = await buildBurn(conn, { wallet: config.burnWallet, mint: open.mint, tokenUnits: wallet.tokenUnits, decimals: mint.decimals, tokenProgram: mint.tokenProgram });
      built.tx.sign([signer]);
      await commit(recordBurn(s, config, open.id, { tokenUnits: wallet.tokenUnits, signature: signedSignature(built.tx), lastValidBlockHeight: built.lastValidBlockHeight }));
      await send(built.tx); action = 'burn-broadcast';
      return;
    }
    const spend = config.officialMint && mint.verified ? plannedSpend(config, wallet.lamports) : null;
    if (spend === null) { action = config.officialMint ? 'below-trigger' : 'awaiting-official-mint'; return; }
    if (!live) { action = 'funds-detected-execution-blocked'; detail = spend; return; }
    const built = await buildBuy(conn, { wallet: config.burnWallet, mint: config.officialMint, spendLamports: spend, slippageBps: config.maxSlippageBps, tokenProgram: mint.tokenProgram });
    if (!built) { action = 'graduated-route-unsupported'; return; }
    built.tx.sign([signer]);
    await commit(recordBuy(s, config, { cycleId: randomUUID(), spendLamports: spend, minTokenUnits: built.minTokenUnits,
      signature: signedSignature(built.tx), lastValidBlockHeight: built.lastValidBlockHeight, now: Date.now() }));
    await send(built.tx); action = 'buy-broadcast';
  });

  const open = openCycle(state);
  await savePrivate('buyback-status.json', {
    observedAt: new Date().toISOString(), executionEnabled: config.executionEnabled, signingEnabled: config.signingEnabled,
    live, blockers, action, detail, burnWallet: config.burnWallet, officialMint: config.officialMint, mintVerified: mint.verified,
    balanceLamports: wallet.lamports, tokenUnits: wallet.tokenUnits, openCycle: open ? { id: open.id, state: open.state } : null,
    cyclesBurned: state.cycles.filter(x => x.state === 'burned').length,
  });
}

tick().catch(async e => {
  // Error text only: never the config, RPC URL or key material.
  const message = String(e?.message || e).slice(0, 200).replace(/api-key=[^&\s]+/gi, 'api-key=[redacted]');
  await savePrivate('buyback-status.json', { observedAt: new Date().toISOString(), live: false, error: message }).catch(() => {});
  console.error(`buyback tick failed: ${message}`); process.exit(1);
});
