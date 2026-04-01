#!/bin/bash
# Usage: spawn-workspace.sh <name> <cwd>
set -euo pipefail

CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
NAME="${1:?Usage: spawn-workspace.sh <name> <cwd>}"
CWD="${2:?Usage: spawn-workspace.sh <name> <cwd>}"

CURRENT=$("$CMUX" current-workspace 2>&1 | awk '{print $1}')
NEW_UUID=$("$CMUX" new-workspace --command "claude" --cwd "$CWD" 2>&1 | awk '{print $2}')
"$CMUX" rename-workspace --workspace "$NEW_UUID" "$NAME" 2>&1
"$CMUX" select-workspace --workspace "$CURRENT" 2>&1
echo "Spawned workspace: $NAME at $CWD"
