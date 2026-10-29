#!/bin/bash
# Points the installed fun.grokgrid.* launchd jobs' stdout/stderr at runtime/logs/<job>.log and
# installs the hourly log-rotate job, without the full installer (which refuses while trading is
# live). Only jobs whose log paths change are reloaded; the trading worker is reloaded only when
# no sell is planned or in flight. Revert: re-run with --revert (points them back at /dev/null).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="${GROKGRID_RUNTIME_DIR:-$HOME/.config/grokgrid/runtime}"
AGENTS="$HOME/Library/LaunchAgents"; UID_N="$(id -u)"; NODE="$(command -v node)"
LOGS="$RUNTIME/logs"; mkdir -p "$LOGS"; chmod 700 "$LOGS"
JOBS=(runtime-observer trading-observer buyback strategy agent-runner pump-callouts x-posts fee-distributor phone-guardian exit-watcher phone-renewal)
# bootout is asynchronous: wait until the job is gone, then load it, retrying a busy launchd.
# A job that cannot be loaded again stops the script loudly instead of silently staying down.
reload() {
  launchctl bootout "gui/$UID_N/fun.grokgrid.$1" 2>/dev/null || true
  for _ in $(seq 1 20); do launchctl print "gui/$UID_N/fun.grokgrid.$1" >/dev/null 2>&1 || break; sleep 0.5; done
  for _ in $(seq 1 10); do launchctl bootstrap "gui/$UID_N" "$2" 2>/dev/null && return 0; sleep 1; done
  echo "  FAILED to reload fun.grokgrid.$1: run  launchctl bootstrap gui/$UID_N $2" >&2; exit 1
}
sells_in_flight() {
  "$NODE" -e "const s=JSON.parse(require('fs').readFileSync('$RUNTIME/trading/trading-journal.json','utf8')).state;process.exit(s.intents.some(i=>i.side==='sell'&&['planned','held-ambiguous'].includes(i.state))?0:1)" 2>/dev/null
}
for j in "${JOBS[@]}"; do
  p="$AGENTS/fun.grokgrid.$j.plist"; [ -f "$p" ] || continue
  want="$LOGS/$j.log"; [ "${1:-}" = "--revert" ] && want=/dev/null
  have="$(/usr/libexec/PlistBuddy -c 'Print StandardErrorPath' "$p" 2>/dev/null || true)"
  [ "$have" = "$want" ] && continue
  if [ "$j" = trading-observer ]; then for _ in $(seq 1 60); do sells_in_flight || break; sleep 2; done; fi
  /usr/libexec/PlistBuddy -c "Set StandardOutPath $want" -c "Set StandardErrorPath $want" "$p" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add StandardOutPath string $want" -c "Add StandardErrorPath string $want" "$p"
  plutil -lint "$p" >/dev/null
  reload "$j" "$p"
  echo "  $j -> $want"
done
if [ "${1:-}" != "--revert" ] && [ ! -f "$AGENTS/fun.grokgrid.log-rotate.plist" ]; then
  sed -e "s#__REPO__#$REPO#g" -e "s#__HOME__#$HOME#g" -e "s#__NODE__#$NODE#g" "$REPO/ops/launchd/fun.grokgrid.log-rotate.plist" > "$AGENTS/fun.grokgrid.log-rotate.plist"
  plutil -lint "$AGENTS/fun.grokgrid.log-rotate.plist" >/dev/null && reload log-rotate "$AGENTS/fun.grokgrid.log-rotate.plist" && echo "  log-rotate installed (hourly, 5 MB x 3)"
fi
