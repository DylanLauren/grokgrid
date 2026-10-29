#!/bin/bash
# Installs (or repoints) the GrokGrid launchd jobs to run from this checkout.
# Run it yourself:  ops/install-launchd.sh [--apply-limits] [--check]
#   --check         run every check and one tick of each worker, but install nothing
#   --apply-limits  writes the placeholder limits into trading-config.json (still observe-only)
# It never turns on execution or signing: it refuses to install if any config does.
# Revert: ops/install-launchd.sh --revert <backup dir it printed>
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="${GROKGRID_RUNTIME_DIR:-$HOME/.config/grokgrid/runtime}"
AGENTS="$HOME/Library/LaunchAgents"
NODE="$(command -v node)"
JOBS=(runtime-observer trading-observer phone-renewal buyback strategy agent-runner pump-callouts x-posts market-recorder)
UID_N="$(id -u)"
APPLY=""; CHECK=""
for a in "$@"; do case "$a" in --apply-limits) APPLY="$a";; --check) CHECK=1;; esac; done

reload() { launchctl bootout "gui/$UID_N/$1" 2>/dev/null || true; launchctl bootstrap "gui/$UID_N" "$AGENTS/$1.plist"; }

if [[ "${1:-}" == "--revert" ]]; then
  BACKUP="${2:?backup dir}"
  for j in "${JOBS[@]}"; do launchctl bootout "gui/$UID_N/fun.grokgrid.$j" 2>/dev/null || true; rm -f "$AGENTS/fun.grokgrid.$j.plist"; done
  cp -p "$BACKUP"/fun.grokgrid.*.plist "$AGENTS/"
  for f in "$BACKUP"/fun.grokgrid.*.plist; do reload "$(basename "$f" .plist)"; done
  echo "Reverted to the jobs in $BACKUP"; exit 0
fi

cd "$REPO"
echo "== checks in $REPO"
[[ -d node_modules ]] || npm ci
GROKGRID_INGEST=off npm test >/dev/null 2>&1 || { echo "Tests fail; not installing."; exit 1; }

echo "== configs (created only if missing, all execution-off)"
GROKGRID_RUNTIME_DIR="$RUNTIME" APPLY_LIMITS="$APPLY" "$NODE" --input-type=module -e '
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { DEFAULT_STRATEGY } from "./scripts/strategy-policy.mjs";
const R = process.env.GROKGRID_RUNTIME_DIR, f = n => R + "/" + n;
const write = (n, v) => { writeFileSync(f(n), JSON.stringify(v, null, 2) + "\n", { mode: 0o600, flag: "wx" }); console.log("  wrote " + n); };
const obs = JSON.parse(readFileSync(f("observer-config.json"), "utf8"));
if (!existsSync(f("strategy-config.json"))) write("strategy-config.json", { ...DEFAULT_STRATEGY, mode: "paper", exitFile: f("EXIT") });
if (!existsSync(f("agent-runner-config.json"))) write("agent-runner-config.json", { version: 1, mode: "paper", stopFile: f("STOP"), exitFile: f("EXIT"), maxAgents: 50,
  caps: { maxTradeLamports: "50000000", maxExposureLamports: "500000000", maxDailyLossLamports: "250000000", reserveLamports: "20000000", maxSlippageBps: 1500 } });
if (!existsSync(f("buyback-config.json"))) write("buyback-config.json", { version: 1, executionEnabled: false, signingEnabled: false, burnWallet: obs.burnWallet, officialMint: null,
  stopFile: f("STOP"), triggerLamports: "50000000", maxSpendLamports: "1000000000", reserveLamports: "10000000", feeAllowanceLamports: "3000000", maxSlippageBps: 500 });
if (process.env.APPLY_LIMITS === "--apply-limits") {
  const t = JSON.parse(readFileSync(f("trading-config.json"), "utf8"));
  Object.assign(t, { maxTradeLamports: "50000000", maxExposureLamports: "500000000", maxDailyLossLamports: "250000000", maxSlippageBps: 1500, reserveLamports: "20000000" });
  writeFileSync(f("trading-config.json.new"), JSON.stringify(t, null, 2) + "\n", { mode: 0o600 }); renameSync(f("trading-config.json.new"), f("trading-config.json"));
  // The journal is fingerprinted to the limits. Only an untouched one (no intents) is set aside.
  const j = f("trading/trading-journal.json");
  if (existsSync(j)) { const s = JSON.parse(readFileSync(j, "utf8")).state;
    if (s.intents.length || (s.launchesObserved || []).length) throw Error("trading journal has history; review before changing limits");
    mkdirSync(f("backup-journals"), { recursive: true, mode: 0o700 }); renameSync(j, f("backup-journals/trading-journal." + Date.now() + ".json")); }
  console.log("  applied placeholder trading limits (observe-only)");
}
// Refuse to install anything that could sign.
const t = JSON.parse(readFileSync(f("trading-config.json"), "utf8")), b = JSON.parse(readFileSync(f("buyback-config.json"), "utf8"));
const a = JSON.parse(readFileSync(f("agent-runner-config.json"), "utf8")), s = JSON.parse(readFileSync(f("strategy-config.json"), "utf8"));
if (t.mode !== "observe-only" || t.executionEnabled !== false || t.signingEnabled !== false || b.executionEnabled !== false || b.signingEnabled !== false || a.mode !== "paper" || s.mode !== "paper")
  throw Error("a config enables execution; this installer only installs execution-off jobs");
console.log("  all configs execution-off");
'

echo "== one tick of each worker"
for w in "runtime-observer.mjs --once" "trading-worker.mjs --once --reconcile" "buyback-worker.mjs --once" "strategy-worker.mjs --once" "agent-runner.mjs --once" "x-post-worker.mjs --once"; do
  # shellcheck disable=SC2086
  GROKGRID_RUNTIME_DIR="$RUNTIME" "$NODE" scripts/$w >/dev/null || { echo "  $w failed; not installing."; exit 1; }
  echo "  ok: $w"
done

[[ -n "$CHECK" ]] && { echo "Check passed; nothing installed."; exit 0; }
BACKUP="$RUNTIME/backup-launchd-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 -p "$BACKUP"
cp -p "$AGENTS"/fun.grokgrid.*.plist "$BACKUP/" 2>/dev/null || true
echo "== installing (backup of old jobs: $BACKUP)"
for j in "${JOBS[@]}"; do
  sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" -e "s#__NODE__#$NODE#g" "ops/launchd/fun.grokgrid.$j.plist" > "$AGENTS/fun.grokgrid.$j.plist"
  plutil -lint "$AGENTS/fun.grokgrid.$j.plist" >/dev/null
  reload "fun.grokgrid.$j"
  echo "  loaded fun.grokgrid.$j"
done
echo "Done. Revert with: ops/install-launchd.sh --revert $BACKUP"
