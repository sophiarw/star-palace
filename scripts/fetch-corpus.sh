#!/usr/bin/env bash
# Downloads the dummy corpus for star-palace MVP seeding.
# Usage: bash scripts/fetch-corpus.sh [dest_dir]
# Default dest: ./dummy-corpus
set -euo pipefail

DEST="${1:-./dummy-corpus}"
mkdir -p "$DEST"

echo "Fetching 20 Newsgroups (~14 MB)..."
if [ ! -d "$DEST/20news-bydate-train" ]; then
  curl -L --retry 3 --retry-delay 2 \
    "http://qwone.com/~jason/20Newsgroups/20news-bydate.tar.gz" \
    | tar xz -C "$DEST"
  echo "  20 Newsgroups extracted. Renaming extensionless files to .txt..."
  find "$DEST/20news-bydate-train" "$DEST/20news-bydate-test" -type f ! -name '*.*' \
    -exec bash -c 'mv "$1" "$1.txt"' _ {} \;
  echo "  Renamed."
else
  echo "  20 Newsgroups already present, skipping."
fi

echo "Cloning public GitHub repos..."

clone_if_missing() {
  local url="$1"
  local dest="$2"
  if [ ! -d "$dest" ]; then
    git clone --depth 1 --quiet "$url" "$dest"
    echo "  Cloned: $dest"
  else
    echo "  Already present: $dest"
  fi
}

clone_if_missing "https://github.com/tj/commander.js.git"    "$DEST/repos/commander.js"
clone_if_missing "https://github.com/expressjs/express.git"  "$DEST/repos/express"
clone_if_missing "https://github.com/sindresorhus/awesome.git" "$DEST/repos/awesome"

echo "Pruning non-text files from repos..."
find "$DEST/repos" -type f ! \( \
  -name '*.md' -o -name '*.txt' -o -name '*.ts' -o -name '*.tsx' \
  -o -name '*.js' -o -name '*.py' -o -name '*.json' -o -name '*.yml' \
  -o -name '*.yaml' -o -name '*.csv' -o -name '*.html' -o -name '*.css' \) -delete 2>/dev/null || true

# Remove .git dirs to avoid indexing git internals
find "$DEST/repos" -type d -name '.git' -exec rm -rf {} + 2>/dev/null || true

TOTAL=$(find "$DEST" -type f | wc -l | tr -d ' ')
echo ""
echo "Corpus ready at $DEST"
echo "Total files: $TOTAL"
echo ""
echo "Run: npm run dev:daemon  (in one terminal)"
echo "     tsx scripts/seed-mvp.ts  (in another)"
