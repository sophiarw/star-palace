#!/usr/bin/env bash
# Install repo-tracked git hooks from scripts/git-hooks/ into .git/hooks/.
# Idempotent. Runs from package.json `prepare` after `npm install`.

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SOURCE_DIR="$HERE/git-hooks"

# .git/hooks may not exist (e.g. fresh worktree). If there's no .git directory
# at all, this isn't a git checkout — bail silently so npm install in archives
# or extracted tarballs doesn't error.
if [ ! -d "$REPO_ROOT/.git" ] && [ ! -f "$REPO_ROOT/.git" ]; then
  exit 0
fi
mkdir -p "$HOOKS_DIR"

for hook in "$SOURCE_DIR"/*; do
  [ -f "$hook" ] || continue
  name="$(basename "$hook")"
  cp "$hook" "$HOOKS_DIR/$name"
  chmod +x "$HOOKS_DIR/$name"
done

echo "[install-git-hooks] installed: $(ls "$SOURCE_DIR" | tr '\n' ' ')"
