#!/usr/bin/env node
// Runs every launched Grok bot, one tick per run. Agents come from the durable launch
// outbox; rules from the registry, never looser than the global caps. Paper mode (default)
// simulates each agent. Execute mode signs through Privy's server wallet API for agents
// with a known Privy wallet id, one transaction in flight per agent, journaled first.
import { open, rename, mkdir, lstat, unlink, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { PrivyClient } from '@privy-io/node';
import { PublicKey } from '@solana/web3.js';
import { validateRunnerConfig, agentTradingPolicy, agentStrategy, privySigner } from './agent-runner-core.mjs';
import { validateStrategyConfig, DEFAULT_STRATEGY } from './strategy-policy.mjs';
import { gatherMarket, marketMetrics } from './strategy-data.mjs';
import { paperTick, paperSummary, emptyPaper, livePlan } from './strategy-engine.mjs';
import { validateLaunchEvents } from './runtime-launch-events.mjs';
import { normalizeLaunchPolicy } from './runtime-launch-rules.mjs';
import { planIntent, setAllowlist, reconcileHeldIntent, dropExpiredSubmission, executes } from './trading-policy.mjs';
import { withTradingStore } from './trading-store.mjs';
import { journalRisk, signNext } from './trading-executor.mjs';
import { createFinalizedReceiptVerifier } from './trading-reconcile.mjs';
import { collectFinalizedPositions } from './trading-positions.mjs';
import { connect, readMint, buildBuy, buildSell, signatureStatus, signedSignature, quoteSell } from './pump-chain.mjs';
import { postCallouts } from './trading-callouts.mjs';
import { heartbeat } from './runtime-ingest.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const ORIGIN = 'https://grokgrid-alpha.vercel.app';
if (process.argv.slice(2).some(x => x !== '--once')) { console.error('Usage: agent-runner.mjs [--once]'); process.exit(1); }
const ownedPrivate = s => (!process.getuid || s.uid === process.getuid()) && (s.mode & 0o077) === 0;
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exists = p => access(p).then(() => true, () => false);

async function json(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await handle.stat(); if (!s.isFile() || !ownedPrivate(s) || s.size > 16 * 1024 * 1024) throw Error('Runtime input must be private and owned'); return JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
}
async function savePrivate(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`; let handle;
  try { handle = await open(tmp, 'wx', 0o600); await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null; await rename(tmp, path); }
  finally { if (handle) await handle.close(); await unlink(tmp).catch(() => {}); }
}
const text = async path => (await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).then(async h => { try { const s = await h.stat(); if (!ownedPrivate(s)) throw Error('Secret file must be private'); return await h.readFile('utf8'); } finally { await h.close(); } })).trim();

/** New confirmed launches from the outbox, then their rules from the registry. */
async function syncAgents(state, token, now) {
  let cursor = state.cursor || '0';
  for (let page = 0; page < 5; page++) {
    const r = await fetch(`${ORIGIN}/api/launch/events?after=${cursor}&limit=50`, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) break;
    const batch = validateLaunchEvents(await r.json(), cursor, now);
    for (const e of batch.events) {
      if (state.agents[e.id]) continue;
      // One agent per wallet and per mint, across all batches: a second claim is quarantined, never run.
      const clash = Object.values(state.agents).find(a => a.wallet === e.wallet || a.mint === e.mint);
      state.agents[e.id] = { id: e.id, wallet: e.wallet, mint: e.mint, queuedAt: e.ts, status: clash ? `quarantined-duplicate-of:${clash.id}` : 'awaiting-rules', ...(e.privyWalletId ? { privyWalletId: e.privyWalletId } : {}) };
    }
    cursor = batch.nextCursor;
    if (!batch.hasMore) break;
  }
  state.cursor = cursor;
  let registry = [];
  try { registry = (await (await fetch(`${ORIGIN}/api/agents`, { redirect: 'error', signal: AbortSignal.timeout(10000) })).json()).agents || []; } catch {}
  for (const a of Object.values(state.agents)) {
    if (a.status.startsWith('quarantined')) continue;
    const record = registry.find(r => r.id === a.id);
    if (!record) continue;
    try {
      const rules = normalizeLaunchPolicy({ id: a.id, wallet: a.wallet, mint: a.mint, queuedAt: a.queuedAt }, record);
      // Rules are pinned on first sight; a later change is flagged, never silently adopted.
      if (a.rules && digest(a.rules) !== digest(rules)) { a.status = 'rules-changed-review'; continue; }
      a.rules ??= rules;
      a.status = 'ready';
    } catch (e) { a.status = `rules-invalid:${String(e.message).slice(0, 40)}`; }
  }
}

/** Prices for coins this agent holds that the shared scan didn't cover. */
async function withHeld(market, mints) {
  const missing = mints.filter(m => !market.metrics.has(m));
  if (missing.length) { try { for (const [k, v] of await marketMetrics(missing)) market.metrics.set(k, v); } catch {} }
  return market;
}

async function runPaper(dir, c, market, now, liquidating) {
  const file = join(dir, 'strategy-paper.json');
  let s; try { const e = await json(file); if (e.sha256 !== digest(e.state)) throw Error('Paper journal checksum mismatch'); s = e.state; } catch (e) { if (e?.code !== 'ENOENT') throw e; s = emptyPaper('500000000'); }
  const next = paperTick(s, c, await withHeld(market, s.positions.map(p => p.mint)), now, liquidating);
  await savePrivate(file, { version: 1, state: next, sha256: digest(next) });
  return { paper: paperSummary(next, market) };
}

async function runLive(dir, agent, policy, c, market, ctx) {
  const { conn, rpcUrl, now, liquidating, stopFilePresent, signerFor } = ctx;
  const positions = await collectFinalizedPositions(rpcUrl, agent.wallet);
  if (!positions?.complete) return { status: 'positions-unavailable' };
  const balance = String(await conn.getBalance(new PublicKey(agent.wallet), 'finalized'));
  const observation = { observedAt: new Date(now).toISOString(), status: 'observing', mode: 'observe-only', executionEnabled: false, signingEnabled: false, house: { wallet: agent.wallet, balanceLamports: balance } };
  await withHeld(market, positions.positions.map(p => p.mint));
  market.sellQuotes = new Map();
  for (const p of positions.positions) if (BigInt(p.spendableTokenUnits) > 0n) { try { const q = await quoteSell(conn, { mint: p.mint, tokenUnits: p.spendableTokenUnits, tokenProgram: p.tokenProgram }); if (q) market.sellQuotes.set(p.mint, q); } catch {} }
  let peaks = {}; try { peaks = (await json(join(dir, 'strategy-live.json'))).peaks || {}; } catch {}
  let pending = null, planned, execution = { reason: 'observe-only' };
  const state = await withTradingStore(join(dir, 'trading'), policy, async s => {
    const verify = createFinalizedReceiptVerifier(rpcUrl);
    for (const i of s.intents.filter(x => x.state === 'held-ambiguous')) {
      s = await reconcileHeldIntent(s, policy, i.id, verify);
      if (s.intents.find(x => x.id === i.id)?.state === 'held-ambiguous' && Number.isSafeInteger(i.lastValidBlockHeight))
        s = dropExpiredSubmission(s, policy, i.id, await signatureStatus(conn, i.signature), await conn.getBlockHeight('finalized'));
    }
    planned = livePlan({ tradingState: s, policy, c, peaks, positions, market, now, liquidating });
    s = setAllowlist(s, policy, planned.allowlist, now);
    for (const p of planned.proposals) {
      const { reason, ...proposal } = p; void reason;
      try { s = planIntent(s, policy, proposal, observation, proposal.side === 'buy' ? journalRisk(s, policy.wallet, now) : null, now, positions); } catch {}
    }
    if (executes(policy)) {
      const signed = await signNext(s, policy, { stopFilePresent, signatureOf: signedSignature, sign: signerFor(agent),
        build: async i => { const { tokenProgram } = await readMint(conn, i.mint);
          // The Privy policy allows no SOL wrap or CloseAccount: curve buys only, pool sells keep WSOL.
          return i.side === 'buy' ? buildBuy(conn, { wallet: policy.wallet, mint: i.mint, spendLamports: i.spendLamports, slippageBps: i.slippageBps, tokenProgram, pool: false })
            : buildSell(conn, { wallet: policy.wallet, mint: i.mint, tokenUnits: i.tokenUnits, minimumReceiveLamports: i.minimumReceiveLamports, slippageBps: i.slippageBps, tokenProgram, unwrap: false }); } }, now);
      s = signed.state; execution = { reason: signed.reason };
      if (signed.tx) pending = signed.tx;
    }
    return s;
  });
  // Journaled; only now broadcast. A send error leaves the intent held for settlement.
  if (pending) try { await conn.sendRawTransaction(pending.serialize(), { skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0 }); execution.broadcast = 'sent'; } catch { execution.broadcast = 'error-held'; }
  await savePrivate(join(dir, 'strategy-live.json'), { peaks: planned.peaks, observedAt: now });
  const callouts = await postCallouts(root, state, { agent: agent.id, ledgerDir: dir }).catch(() => null);
  return { status: executes(policy) ? 'executing' : 'observing', execution, intents: state.intents.length, callouts };
}

async function tick() {
  const rs = await lstat(root); if (!rs.isDirectory() || rs.isSymbolicLink() || !ownedPrivate(rs)) throw Error('Runtime directory must be private and owned');
  const c = validateRunnerConfig(await json(join(root, 'agent-runner-config.json')));
  const rpc = await json(join(root, 'observer-config.json'));
  const token = await text(rpc.tokenFile);
  const conn = connect(rpc.rpcUrl), now = Date.now();
  const stateFile = join(root, 'agent-runner-state.json');
  let state; try { state = await json(stateFile); } catch { state = { version: 1, cursor: '0', agents: {} }; }
  await syncAgents(state, token, now);
  await savePrivate(stateFile, state);

  let global = { ...DEFAULT_STRATEGY }; try { global = await json(join(root, 'strategy-config.json')); } catch {}
  global = validateStrategyConfig({ ...DEFAULT_STRATEGY, ...global, mode: c.mode === 'execute' ? 'live' : 'paper' });
  // Defence in depth: never run two agents on one wallet, whatever the state file says.
  const wallets = new Set();
  const ready = Object.values(state.agents).filter(a => a.status === 'ready' && !wallets.has(a.wallet) && wallets.add(a.wallet)).slice(0, c.maxAgents);
  const liquidating = await exists(c.exitFile), stopFilePresent = await exists(c.stopFile);
  let privy = null, authorizationKey = null;
  const signerFor = agent => async tx => {
    if (!privy) { const cfg = await json(c.privyServerFile); privy = new PrivyClient({ appId: cfg.appId, appSecret: cfg.appSecret }); authorizationKey = await text(c.privyAuthorizationKeyFile); }
    return privySigner({ wallets: privy.wallets(), walletId: agent.privyWalletId, address: agent.wallet, authorizationKey })(tx);
  };
  // One market read for every agent: candidates plus everything any agent holds.
  const market = await gatherMarket(global, conn, rpc.rpcUrl, [], now);
  const report = {};
  for (const agent of ready) {
    const dir = join(root, 'agents', agent.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const c2 = agentStrategy(global, agent.rules);
      // Privy agents can only buy on the bonding curve (their policy allows no SOL wrap), so they
      // never pick graduated coins (paper mode too, so its results stay honest). Held coins are priced later.
      const agentMarket = { ...market, metrics: new Map([...market.metrics].filter(([, m]) => m.dexId === 'pumpfun')), facts: market.facts };
      if (c.mode === 'paper') report[agent.id] = await runPaper(dir, c2, agentMarket, now, liquidating);
      else {
        const policy = agentTradingPolicy(c, { ...agent, maxTradeLamports: agent.rules.maxTradeLamports });
        report[agent.id] = executes(policy) ? await runLive(dir, agent, policy, c2, agentMarket, { conn, rpcUrl: rpc.rpcUrl, now, liquidating, stopFilePresent, signerFor })
          : { status: 'awaiting-wallet-id' };
      }
    } catch (e) { report[agent.id] = { status: 'error', error: String(e?.message || e).slice(0, 120).replace(/api-key=[^&\s]+/gi, '') }; }
  }
  const healthy = Object.values(report).every(r => r.status !== 'error');
  await savePrivate(join(root, 'agent-runner-status.json'), { observedAt: new Date(now).toISOString(), mode: c.mode, strategyValidated: false, liquidating, stopFilePresent,
    known: Object.keys(state.agents).length, running: ready.length, cursor: state.cursor, agents: report });
  await heartbeat(root, 'agent-runner', { mode: c.mode === 'execute' ? 'execute' : 'paper', healthy, agents: ready.length, note: `${ready.length} agents, ${c.mode}` });
  console.log(JSON.stringify({ mode: c.mode, known: Object.keys(state.agents).length, running: ready.length, healthy }));
}

tick().catch(async e => {
  const message = String(e?.message || e).slice(0, 200).replace(/api-key=[^&\s]+/gi, 'api-key=[redacted]');
  await savePrivate(join(root, 'agent-runner-status.json'), { observedAt: new Date().toISOString(), error: message }).catch(() => {});
  await heartbeat(root, 'agent-runner', { mode: 'paper', healthy: false, note: 'tick failed' });
  console.error(`agent runner tick failed: ${message}`); process.exit(1);
});
