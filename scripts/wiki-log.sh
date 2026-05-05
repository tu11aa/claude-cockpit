#!/bin/bash
# Usage: wiki-log.sh <spoke-vault-path> [lines]
# Reads recent wiki changelog entries. Default: 20 lines.
set -euo pipefail

VAULT="${1:?Usage: wiki-log.sh <vault> [lines]}"
LINES="${2:-20}"
LOG_FILE="${VAULT}/wiki/log.md"

if [ ! -f "$LOG_FILE" ]; then
  echo "No wiki log found at ${LOG_FILE}"
  exit 0
fi

# Show the N most recent entries (lines starting with "- **")
grep '^- \*\*' "$LOG_FILE" 2>/dev/null | head -n "$LINES"

COUNT=$(grep -c '^- \*\*' "$LOG_FILE" 2>/dev/null || echo "0")
echo ""
echo "Total wiki changes: ${COUNT}"
