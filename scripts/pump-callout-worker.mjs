#!/usr/bin/env node
// One pump.fun Callout check per run. --dry-run asks pump.fun for eligibility and stops
// before creating anything. Without it, a callout is made only if pumpCalloutsEnabled.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readPrivateText, savePrivateJSON } from './runtime-observation-store.mjs';
import { validateTradingPolicy, validateTradingState } from './trading-policy.mjs';
import { DEFAULT_CALLOUTS, pickCallout, calloutGate, thesis, runCallout } from './pump-callouts.mjs';
import { marketMetrics } from './strategy-data.mjs';
import { action } from './runtime-ingest.mjs';

const root = resolve(process.env.GROKGRID_RUNTIME_DIR || join(homedir(), '.config/grokgrid/runtime'));
const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
if (args.some(a => !['--once', '--dry-run', '--mint'].includes(a) && args[args.indexOf('--mint') + 1] !== a)) { console.error('Usage: pump-callout-worker.mjs [--once] [--dry-run [--mint <mint>]]'); process.exit(1); }
const read = async (name, fallback) => { try { return JSON.parse(await readPrivateText(join(root, name))); } catch { return fallback; } };

const cfg = { ...DEFAULT_CALLOUTS, ...(await read('callout-config.json', {})) };
const ledger = await read('pump-callouts.json', { version: 1, calls: [] });
const now = Date.now();
let intent = null;
const policy = validateTradingPolicy(await read('trading-config.json', null));
const journal = await read('trading/trading-journal.json', null);
if (journal) intent = pickCallout(validateTradingState(journal.state, policy), await read('trading-positions.json', null));
// A dry run may name any mint to probe eligibility; it never creates.
const mint = dryRun && args.includes('--mint') ? args[args.indexOf('--mint') + 1] : intent?.mint;
const gate = dryRun ? (mint ? 'ok' : 'nothing-held') : calloutGate(ledger, cfg, intent, now);
let result = gate;
if (gate === 'ok') {
  let symbol; try { symbol = (await marketMetrics([mint])).get(mint)?.symbol; } catch {}
  result = await runCallout(cfg, mint, intent ? thesis(intent, symbol) : 'dry run', dryRun);
  if (!dryRun) {
    ledger.calls = [...(ledger.calls || []), { at: now, mint, signature: intent.signature, outcome: result === 'create-http-200' || result === 'create-http-201' ? 'posted' : result }].slice(-200);
    await savePrivateJSON(join(root, 'pump-callouts.json'), ledger);
    if (ledger.calls.at(-1).outcome === 'posted') await action(root, `called $${symbol || 'a coin'} on pump.fun`);
  }
}
await savePrivateJSON(join(root, 'pump-callout-status.json'), { observedAt: new Date(now).toISOString(), dryRun, enabled: cfg.pumpCalloutsEnabled, mint: mint || null, result });
console.log(JSON.stringify({ dryRun, enabled: cfg.pumpCalloutsEnabled, mint: mint || null, result }));
