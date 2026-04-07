#!/bin/bash
# Usage: wiki-query.sh <spoke-vault-path> <keyword> [--titles-only]
# Searches wiki pages by keyword. Returns matching pages with excerpts.
set -euo pipefail

VAULT="${1:?Usage: wiki-query.sh <vault> <keyword> [--titles-only]}"
KEYWORD="${2:?}"
TITLES_ONLY="${3:-}"
WIKI_DIR="${VAULT}/wiki/pages"

if [ ! -d "$WIKI_DIR" ]; then
  echo "No wiki found at ${WIKI_DIR}"
  exit 0
fi

MATCHES=$(grep -rl "$KEYWORD" "$WIKI_DIR" 2>/dev/null || true)

if [ -z "$MATCHES" ]; then
  echo "No wiki pages match '${KEYWORD}'"
  exit 0
fi

if [ "$TITLES_ONLY" = "--titles-only" ]; then
  echo "$MATCHES" | while read -r f; do
    SLUG=$(basename "$f" .md)
    TITLE=$(grep -m1 '^title:' "$f" | sed 's/title:[[:space:]]*//;s/^"//;s/"$//')
    echo "- ${SLUG}: ${TITLE}"
  done
else
  echo "$MATCHES" | while read -r f; do
    SLUG=$(basename "$f" .md)
    echo "=== ${SLUG} ==="
    grep -n -C 2 "$KEYWORD" "$f" 2>/dev/null || true
    echo ""
  done
fi
