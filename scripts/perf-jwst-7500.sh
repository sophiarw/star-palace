#!/usr/bin/env bash
# Bring up an isolated Star Palace daemon pointed at a perf-test DB and seed it
# with the 7500-file JWST renderer perf corpus.
#
# Usage:
#   bash scripts/perf-jwst-7500.sh        # build corpus + start daemon + seed
#   bash scripts/perf-jwst-7500.sh --keep # skip kill of existing :7373 listener
#
# After this script completes, in another shell:
#   npm run dev:web   # renderer talks to daemon on :7373
# Then press Shift+P to open PerfOverlay and observe:
#   spriteCache.typed.bakesPerformed   — full-quality bakes this frame
#   spriteCache.typed.bakesDeferred    — over-budget cheap-fallback misses
#   spriteCache.typed.bytes            — typed cache RSS (vs 512 MB cap)

set -euo pipefail

cd "$(dirname "$0")/.."

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

export STARPALACE_DIR="${STARPALACE_DIR:-$HOME/.starpalace-perf}"
export STARPALACE_DB="${STARPALACE_DB:-$STARPALACE_DIR/index.db}"

mkdir -p "$STARPALACE_DIR"

echo "Perf dir: $STARPALACE_DIR"
echo "Perf DB:  $STARPALACE_DB"
echo

if [[ "$KEEP" -eq 0 ]]; then
  if lsof -ti :7373 >/dev/null 2>&1; then
    echo "Killing existing daemon on :7373..."
    lsof -ti :7373 | xargs kill -9 || true
    sleep 1
  fi
fi

echo "Building perf corpus (7500 files)..."
node scripts/build-perf-corpus.mjs
echo

DAEMON_LOG=/tmp/starpalace-perf-daemon.log
echo "Starting daemon (log: $DAEMON_LOG)..."
nohup npm run dev:daemon > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
echo "Daemon PID: $DAEMON_PID"
echo

sleep 3

echo "Seeding perf DB (this can take several minutes for 7500 embeddings)..."
npx tsx scripts/seed-perf.ts

echo
echo "==============================================================="
echo "Perf DB ready."
echo "  Daemon PID:   $DAEMON_PID"
echo "  Daemon log:   tail -f $DAEMON_LOG"
echo "  Stop daemon:  kill $DAEMON_PID"
echo "  Renderer:     npm run dev:web"
echo "  PerfOverlay:  Shift+P inside the app"
echo "==============================================================="
