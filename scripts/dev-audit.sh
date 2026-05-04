#!/usr/bin/env bash
# Bring up an isolated Star Palace daemon pointed at an audit DB and seed it
# with the graphics-audit corpus (10 star_types × 21 variants).
#
# Usage:
#   bash scripts/dev-audit.sh        # build corpus + start daemon + seed
#   bash scripts/dev-audit.sh --keep # skip kill of existing :7373 listener
#
# After this script completes, in another shell:
#   npm run dev:web   # renderer talks to daemon on :7373

set -euo pipefail

cd "$(dirname "$0")/.."

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

export STARPALACE_DIR="${STARPALACE_DIR:-$HOME/.starpalace-audit}"
export STARPALACE_DB="${STARPALACE_DB:-$STARPALACE_DIR/index.db}"

mkdir -p "$STARPALACE_DIR"

echo "Audit dir: $STARPALACE_DIR"
echo "Audit DB:  $STARPALACE_DB"
echo

if [[ "$KEEP" -eq 0 ]]; then
  if lsof -ti :7373 >/dev/null 2>&1; then
    echo "Killing existing daemon on :7373..."
    lsof -ti :7373 | xargs kill -9 || true
    sleep 1
  fi
fi

echo "Building audit corpus..."
node scripts/build-audit-corpus.mjs
echo

DAEMON_LOG=/tmp/starpalace-audit-daemon.log
echo "Starting daemon (log: $DAEMON_LOG)..."
nohup npm run dev:daemon > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
echo "Daemon PID: $DAEMON_PID"
echo

# Give the daemon a moment to bind :7373 before seed polls.
sleep 3

echo "Seeding audit DB..."
npx tsx scripts/seed-audit.ts

echo
echo "==============================================================="
echo "Audit DB ready."
echo "  Daemon PID:   $DAEMON_PID"
echo "  Daemon log:   tail -f $DAEMON_LOG"
echo "  Stop daemon:  kill $DAEMON_PID"
echo "  Renderer:     npm run dev:web"
echo "  Deck:         open docs/three-new-themes/index.html"
echo "==============================================================="
