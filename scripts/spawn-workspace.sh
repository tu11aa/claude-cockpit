#!/bin/bash
# Usage: spawn-workspace.sh <name> <cwd>
set -euo pipefail
NAME="${1:?Usage: spawn-workspace.sh <name> <cwd>}"
CWD="${2:?Usage: spawn-workspace.sh <name> <cwd>}"
CURRENT=$(cmux current-workspace 2>&1 | awk '{print $1}')
NEW_UUID=$(cmux new-workspace --command "claude" --cwd "$CWD" 2>&1 | awk '{print $2}')
cmux rename-workspace --workspace "$NEW_UUID" "$NAME" 2>&1
cmux select-workspace --workspace "$CURRENT" 2>&1
echo "Spawned workspace: $NAME at $CWD"
