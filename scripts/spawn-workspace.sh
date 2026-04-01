#!/bin/bash
# Usage: spawn-workspace.sh <name> <cwd> [role]
# role: "captain" | "crew" (default: "captain")
set -euo pipefail

CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
TEMPLATES_DIR="${HOME}/.config/cockpit/templates"
NAME="${1:?Usage: spawn-workspace.sh <name> <cwd> [role]}"
CWD="${2:?Usage: spawn-workspace.sh <name> <cwd> [role]}"
ROLE="${3:-captain}"

# Build claude command with role-specific prompt appended
CLAUDE_CMD="claude -c"
ROLE_FILE="${TEMPLATES_DIR}/${ROLE}.CLAUDE.md"
if [ -f "$ROLE_FILE" ]; then
  CLAUDE_CMD="claude -c --append-system-prompt-file ${ROLE_FILE}"
fi

# Also append learnings instructions for captains
LEARNINGS_FILE="${TEMPLATES_DIR}/learnings.CLAUDE.md"
if [ "$ROLE" = "captain" ] && [ -f "$LEARNINGS_FILE" ]; then
  CLAUDE_CMD="${CLAUDE_CMD} --append-system-prompt-file ${LEARNINGS_FILE}"
fi

CURRENT=$("$CMUX" current-workspace 2>&1 | awk '{print $1}')
NEW_UUID=$("$CMUX" new-workspace --command "$CLAUDE_CMD" --cwd "$CWD" 2>&1 | awk '{print $2}')
"$CMUX" rename-workspace --workspace "$NEW_UUID" "$NAME" 2>&1
"$CMUX" select-workspace --workspace "$CURRENT" 2>&1
echo "Spawned workspace: $NAME at $CWD (role: $ROLE)"
