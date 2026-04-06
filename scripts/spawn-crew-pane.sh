#!/bin/bash
# Usage: spawn-crew-pane.sh <captain-workspace-ref> <crew-name> <task-prompt> [direction]
# Spawns a crew member as a split pane next to the captain
set -euo pipefail

CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
CAPTAIN_WS="${1:?Usage: spawn-crew-pane.sh <captain-workspace-ref> <crew-name> <task-prompt> [direction]}"
CREW_NAME="${2:?}"
TASK="${3:?}"
DIRECTION="${4:-right}"

# Create a split pane in the captain's workspace
PANE_OUTPUT=$("$CMUX" new-split "$DIRECTION" --workspace "$CAPTAIN_WS" 2>&1)
PANE_REF=$(echo "$PANE_OUTPUT" | grep -o 'surface:[0-9]*' | head -1)

if [ -z "$PANE_REF" ]; then
  echo "Failed to create split pane: $PANE_OUTPUT"
  exit 1
fi

# Rename the tab for the crew pane
"$CMUX" rename-tab --surface "$PANE_REF" --workspace "$CAPTAIN_WS" "🔧 $CREW_NAME" 2>/dev/null || true

# Start Claude Code in the crew pane with the task
# Use --permission-mode acceptEdits so crew can work
CLAUDE_CMD="claude --permission-mode acceptEdits -p \"You are a crew member (🔧 ${CREW_NAME}). ${TASK} When done, summarize what you did and what branch/PR was created.\""
"$CMUX" send --workspace "$CAPTAIN_WS" --surface "$PANE_REF" "$CLAUDE_CMD" 2>&1
"$CMUX" send-key --workspace "$CAPTAIN_WS" --surface "$PANE_REF" Enter 2>&1

echo "Spawned crew pane: $PANE_REF (🔧 $CREW_NAME) in $CAPTAIN_WS [$DIRECTION]"
