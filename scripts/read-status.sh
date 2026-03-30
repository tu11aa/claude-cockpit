#!/bin/bash
# Usage: read-status.sh [spoke-vault-path]
# Without args: reads all spoke vaults from config, outputs JSON
# With arg: reads one spoke vault
set -euo pipefail
CONFIG_PATH="${HOME}/.config/cockpit/config.json"
if [ ! -f "$CONFIG_PATH" ]; then
  echo '{"error": "No config found"}' >&2
  exit 1
fi
if [ -n "${1:-}" ]; then
  STATUS_FILE="$1/status.md"
  if [ -f "$STATUS_FILE" ]; then
    sed -n '/^---$/,/^---$/p' "$STATUS_FILE" | sed '1d;$d'
  else
    echo "No status file at $STATUS_FILE" >&2
    exit 1
  fi
else
  echo "{"
  FIRST=true
  for VAULT in $(python3 -c "
import json, os
config = json.load(open(os.path.expanduser('$CONFIG_PATH')))
for p in config.get('projects', {}).values():
    print(os.path.expanduser(p.get('spokeVault', '')))
"); do
    STATUS_FILE="$VAULT/status.md"
    if [ -f "$STATUS_FILE" ]; then
      if [ "$FIRST" = true ]; then FIRST=false; else echo ","; fi
      PROJECT=$(sed -n 's/^project: *//p' "$STATUS_FILE" | head -1)
      echo "  \"$PROJECT\": {"
      sed -n '/^---$/,/^---$/p' "$STATUS_FILE" | sed '1d;$d' | while IFS= read -r line; do
        KEY=$(echo "$line" | cut -d: -f1 | xargs)
        VAL=$(echo "$line" | cut -d: -f2- | xargs)
        echo "    \"$KEY\": \"$VAL\","
      done
      echo "  }"
    fi
  done
  echo "}"
fi
