#!/bin/bash
# Usage: read-handoff.sh <spoke-vault-path> [--keep]
# Reads and prints handoff.json, then deletes it (unless --keep).
# Captain calls this on session startup to load previous context.
set -euo pipefail

VAULT="${1:?Usage: read-handoff.sh <vault-path> [--keep]}"
KEEP="${2:-}"
HANDOFF_FILE="$VAULT/handoff.json"

if [ ! -f "$HANDOFF_FILE" ]; then
  echo '{"exists": false}'
  exit 0
fi

# Print the handoff content
cat "$HANDOFF_FILE"

# Delete unless --keep flag
if [ "$KEEP" != "--keep" ]; then
  rm "$HANDOFF_FILE"
fi
