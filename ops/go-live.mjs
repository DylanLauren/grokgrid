#!/usr/bin/env node
// dlao's switches for real money. Each one checks everything first, asks for a typed
// confirmation, and changes only its own config. Nothing here moves funds or signs.
//   npx tsx ops/go-live.mjs status
//   npx tsx ops/go-live.mjs house            house bot: strategy live + trading execute
//   npx tsx ops/go-live.mjs buyback <mint>   buy-and-burn on, for the official $GRID mint
//   npx tsx ops/go-live.mjs runner           user agents sign through Privy
//   npx tsx ops/go-live.mjs callouts on|off  pump.fun Callouts from the GrokGrid profile
//   npx tsx ops/go-live.mjs x on|off         post real trades to X
//   npx tsx ops/go-live.mjs stop | resume    freeze / unfreeze all signing (STOP file)
//   npx tsx ops/go-live.mjs exit | unexit    sell everything and stop buying (EXIT file)
//   npx tsx ops/go-live.mjs off              every config back to observe-only / paper
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { loadSigner, connect, readMint } from '../scripts/pump-chain.mjs';
import { validateTradingPolicy } from '../scripts/trading-policy.mjs';
import { validateBuybackConfig } from '../scripts/buyback-policy.mjs';
import { validateRunnerConfig } from '../scripts/agent-runner-core.mjs';
import { validateStrategyConfig } from '../scripts/strategy-policy.mjs';

const GG = join(homedir(), '.config/grokgrid'), R = process.env.GROKGRID_RUNTIME_DIR || join(GG, 'runtime');
const f = n => join(R, n);
const read = n => JSON.parse(readFileSync(f(n), 'utf8'));
const write = (n, v) => { writeFileSync(f(n) + '.new', JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); renameSync(f(n) + '.new', f(n)); console.log(`  updated ${n}`); };
const address = x => typeof x === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);

async function confirm(what, phrase) {
  console.log(`\n${what}\nType "${phrase}" to continue:`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('> ')).trim(); rl.close();
  if (answer !== phrase) { console.log('Cancelled; nothing changed.'); process.exit(1); }
}

/** The trading journal is fingerprinted to its policy; only an untouched one is set aside. */
function resetJournalIfEmpty(dir) {
  const j = join(dir, 'trading-journal.json');
  if (!existsSync(j)) return;
  const s = JSON.parse(readFileSync(j, 'utf8')).state;
  if (s.intents.length) throw Error('The trading journal has trades in it; review before switching mode.');
  mkdirSync(f('backup-journals'), { recursive: true, mode: 0o700 });
  renameSync(j, f(`backup-journals/trading-journal.${Date.now()}.json`));
}

function status() {
  const show = (n, pick) => { try { console.log(`  ${n.padEnd(26)} ${pick(read(n))}`); } catch { console.log(`  ${n.padEnd(26)} missing`); } };
  show('trading-config.json', t => `${t.mode}, mints ${Array.isArray(t.allowedMints) ? t.allowedMints.length : t.allowedMints}`);
  show('strategy-config.json', s => s.mode);
  show('buyback-config.json', b => `${b.executionEnabled && b.signingEnabled ? 'ON' : 'off'}, mint ${b.officialMint || 'unset'}`);
  show('agent-runner-config.json', a => a.mode);
  show('callout-config.json', c => c.pumpCalloutsEnabled ? 'ON' : 'off');
  show('x-config.json', c => c.xPostsEnabled ? 'ON' : 'off');
  console.log(`  STOP file                  ${existsSync(f('STOP')) ? 'PRESENT (signing frozen)' : 'absent'}`);
  console.log(`  EXIT file                  ${existsSync(f('EXIT')) ? 'PRESENT (selling everything)' : 'absent'}`);
}

async function house() {
  const t = read('trading-config.json'), obs = read('observer-config.json');
  const keypairFile = join(GG, 'wallets', `${t.wallet}.json`);
  await loadSigner(keypairFile, t.wallet); // checks 0600 and that it is the house key; never prints it
  const balance = await connect(obs.rpcUrl).getBalance(new (await import('@solana/web3.js')).PublicKey(t.wallet), 'finalized');
  console.log(`House wallet ${t.wallet}: ${(balance / 1e9).toFixed(4)} SOL. Limits: ${Number(t.maxTradeLamports) / 1e9} SOL/trade, ${Number(t.maxExposureLamports) / 1e9} SOL exposure, ${Number(t.maxDailyLossLamports) / 1e9} SOL daily loss stop.`);
  if (balance < Number(t.reserveLamports) + Number(t.maxTradeLamports)) throw Error('Fund the house wallet first (at least one trade plus the reserve).');
  await confirm('The house bot will trade REAL SOL on its own (strategy is unvalidated).', 'go live house');
  const next = validateTradingPolicy({ ...t, mode: 'execute', executionEnabled: true, signingEnabled: true, stopFile: f('STOP'), keypairFile, allowedMints: 'dynamic' });
  resetJournalIfEmpty(f('trading'));
  write('trading-config.json', next);
  write('strategy-config.json', validateStrategyConfig({ ...read('strategy-config.json'), mode: 'live' }));
}

async function buyback(mint) {
  if (!address(mint)) throw Error('Usage: go-live.mjs buyback <official $GRID mint>');
  if (mint === 'So11111111111111111111111111111111111111112') throw Error('That is wrapped SOL, not $GRID.');
  const b = read('buyback-config.json'), obs = read('observer-config.json');
  const m = await readMint(connect(obs.rpcUrl), mint);
  if (!m.verified) throw Error('That mint is not a fixed-supply token (it has a mint or freeze authority, or does not exist).');
  const keypairFile = join(GG, 'wallets', 'grid-burn.json');
  await loadSigner(keypairFile, b.burnWallet);
  await confirm(`Buy-and-burn will spend the burn wallet's SOL on ${mint} and burn every token it buys.`, 'go live burn');
  write('buyback-config.json', validateBuybackConfig({ ...b, officialMint: mint, keypairFile, executionEnabled: true, signingEnabled: true }));
  console.log('  Also set VITE_MAIN_MINT in Vercel to this mint and redeploy.');
}

async function runner() {
  const a = read('agent-runner-config.json');
  const privyServerFile = f('privy-server.json'), privyAuthorizationKeyFile = f('privy-authorization.key');
  for (const p of [privyServerFile, privyAuthorizationKeyFile]) if (!existsSync(p) || (statSync(p).mode & 0o077)) throw Error(`${p} missing or not 0600: finish the Privy steps first.`);
  if (!existsSync(f('privy-setup.json'))) throw Error('Run ops/privy-setup.mjs first.');
  await confirm('User-launched bots will trade their owners\' SOL through Privy within the caps.', 'go live agents');
  write('agent-runner-config.json', validateRunnerConfig({ ...a, mode: 'execute', privyServerFile, privyAuthorizationKeyFile }));
  console.log('  Launches open only when the runner beats healthy in execute mode AND LAUNCHES_ENABLED=1 is set in Vercel.');
}

async function flag(file, key, value, what, phrase) {
  if (!['on', 'off'].includes(value)) throw Error('Use on or off');
  let c = {}; try { c = read(file); } catch {}
  if (value === 'on') await confirm(what, phrase);
  write(file, { ...c, [key]: value === 'on' });
}

function off() {
  const t = read('trading-config.json');
  const { stopFile, keypairFile, ...rest } = t; void stopFile; void keypairFile;
  // Freeze first, so nothing signs while configs change. With trade history the house
  // config stays as it is (its journal is fingerprinted to it) and the STOP file holds it.
  writeFileSync(f('STOP'), '', { mode: 0o600 }); console.log('  STOP file created');
  if (t.mode === 'execute') {
    try { resetJournalIfEmpty(f('trading')); write('trading-config.json', validateTradingPolicy({ ...rest, mode: 'observe-only', executionEnabled: false, signingEnabled: false })); }
    catch { console.log('  house has trade history: left in execute mode, frozen by STOP'); }
  }
  write('strategy-config.json', { ...read('strategy-config.json'), mode: 'paper' });
  write('buyback-config.json', { ...read('buyback-config.json'), executionEnabled: false, signingEnabled: false });
  write('agent-runner-config.json', { ...read('agent-runner-config.json'), mode: 'paper' });
  for (const [file, key] of [['callout-config.json', 'pumpCalloutsEnabled'], ['x-config.json', 'xPostsEnabled']]) { let c = {}; try { c = read(file); } catch {} write(file, { ...c, [key]: false }); }
}

const [cmd, arg] = process.argv.slice(2);
const touch = n => { writeFileSync(f(n), '', { mode: 0o600 }); console.log(`  ${n} file created`); };
const remove = n => { if (existsSync(f(n))) unlinkSync(f(n)); console.log(`  ${n} file removed`); };
try {
  if (cmd === 'house') await house();
  else if (cmd === 'buyback') await buyback(arg);
  else if (cmd === 'runner') await runner();
  else if (cmd === 'callouts') await flag('callout-config.json', 'pumpCalloutsEnabled', arg, 'The GrokGrid pump.fun profile will make a public Callout (max 1 per 6h) for coins the house really holds.', 'go live callouts');
  else if (cmd === 'x') await flag('x-config.json', 'xPostsEnabled', arg, 'Real trades will be posted publicly to X.', 'go live x');
  else if (cmd === 'stop') touch('STOP');
  else if (cmd === 'resume') remove('STOP');
  else if (cmd === 'exit') touch('EXIT');
  else if (cmd === 'unexit') remove('EXIT');
  else if (cmd === 'off') { await confirm('Every worker goes back to observe-only / paper.', 'all off'); off(); }
  else if (cmd !== 'status') { console.log('Commands: status | house | buyback <mint> | runner | callouts on|off | x on|off | stop | resume | exit | unexit | off'); process.exit(1); }
  console.log('\nNow:'); status();
} catch (e) { console.error(`Not changed: ${String(e?.message || e).slice(0, 200)}`); process.exit(1); }
