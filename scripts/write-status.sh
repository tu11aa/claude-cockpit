#!/bin/bash
# Usage: write-status.sh <spoke-vault-path> <key> <value> [activity-line]
set -euo pipefail
VAULT="${1:?Usage: write-status.sh <vault-path> <key> <value> [activity]}"
KEY="${2:?}"
VALUE="${3:?}"
ACTIVITY="${4:-}"
STATUS_FILE="$VAULT/status.md"
if [ ! -f "$STATUS_FILE" ]; then
  mkdir -p "$VAULT"
  cat > "$STATUS_FILE" << EOF
---
project: unknown
captain_session: inactive
last_updated: $(date -u +"%Y-%m-%dT%H:%M:%S")
active_crew: 0
tasks_total: 0
tasks_completed: 0
tasks_in_progress: 0
tasks_pending: 0
---

# Captain Status

## Active Crew

| Crew | Task | Branch | Status |
|------|------|--------|--------|

## Recent Activity
EOF
fi
if grep -q "^${KEY}:" "$STATUS_FILE"; then
  sed -i '' "s/^${KEY}:.*/${KEY}: ${VALUE}/" "$STATUS_FILE"
else
  sed -i '' "/^---$/a\\
${KEY}: ${VALUE}
" "$STATUS_FILE"
fi
sed -i '' "s/^last_updated:.*/last_updated: $(date -u +"%Y-%m-%dT%H:%M:%S")/" "$STATUS_FILE"
if [ -n "$ACTIVITY" ]; then
  echo "- $(date +"%H:%M") — $ACTIVITY" >> "$STATUS_FILE"
fi
