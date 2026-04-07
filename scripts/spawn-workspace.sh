#!/bin/bash
# Usage: spawn-workspace.sh <name> <cwd> [role] [--fresh]
# role: "captain" | "crew" | "command" | "reactor" (default: "captain")
# --fresh: force a new session instead of resuming
set -euo pipefail

CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
TEMPLATES_DIR="${HOME}/.config/cockpit/templates"
SESSIONS_FILE="${HOME}/.config/cockpit/sessions.json"
NAME="${1:?Usage: spawn-workspace.sh <name> <cwd> [role] [--fresh]}"
CWD="${2:?Usage: spawn-workspace.sh <name> <cwd> [role] [--fresh]}"
ROLE="${3:-captain}"
FORCE_FRESH="${4:-}"

TODAY=$(date +"%Y-%m-%d")
FRESH=false

# --- Session freshness check ---
if [ "$FORCE_FRESH" = "--fresh" ]; then
  FRESH=true
elif [ -f "$SESSIONS_FILE" ]; then
  # Check last launch date
  LAST_DATE=$(python3 -c "
import json, sys
try:
    data = json.load(open('$SESSIONS_FILE'))
    print(data.get('workspaces', {}).get('$NAME', {}).get('lastLaunched', ''))
except: print('')
" 2>/dev/null)

  if [ -z "$LAST_DATE" ]; then
    FRESH=true  # first launch
  elif [ "$LAST_DATE" != "$TODAY" ]; then
    FRESH=true  # new day
    echo "↻ new day — starting fresh session for $NAME"
  fi

  # Check template + skills hash
  if [ "$FRESH" = "false" ]; then
    CURRENT_HASH=$(cat "${TEMPLATES_DIR}/${ROLE}.CLAUDE.md" "${HOME}/.config/cockpit/plugin/skills"/*/SKILL.md 2>/dev/null | shasum -a 256 | cut -c1-16)
    STORED_HASH=$(python3 -c "
import json
try:
    data = json.load(open('$SESSIONS_FILE'))
    print(data.get('workspaces', {}).get('$NAME', {}).get('templateHash', ''))
except: print('')
" 2>/dev/null)
    if [ -n "$CURRENT_HASH" ] && [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
      FRESH=true
      echo "↻ template instructions updated — starting fresh session for $NAME"
    fi
  fi
else
  FRESH=true  # no sessions file yet
fi

# --- Record session ---
CURRENT_HASH=$(cat "${TEMPLATES_DIR}/${ROLE}.CLAUDE.md" "${HOME}/.config/cockpit/plugin/skills"/*/SKILL.md 2>/dev/null | shasum -a 256 | cut -c1-16)
python3 -c "
import json, os
path = '$SESSIONS_FILE'
try:
    data = json.load(open(path))
except: data = {'workspaces': {}}
data.setdefault('workspaces', {})['$NAME'] = {'lastLaunched': '$TODAY', 'templateHash': '$CURRENT_HASH'}
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(data, open(path, 'w'), indent=2)
" 2>/dev/null

# --- Build claude command ---
if [ "$FRESH" = "true" ]; then
  CLAUDE_CMD="claude"
else
  CLAUDE_CMD="claude -c"
fi

# Read permission mode from config
PERM_MODE=$(python3 -c "
import json
try:
    cfg = json.load(open('${HOME}/.config/cockpit/config.json'))
    role_key = '$ROLE' if '$ROLE' in ('captain', 'command', 'reactor') else 'captain'
    print(cfg.get('defaults', {}).get('permissions', {}).get(role_key, 'default'))
except: print('default')
" 2>/dev/null)

if [ "$PERM_MODE" = "acceptEdits" ]; then
  CLAUDE_CMD="${CLAUDE_CMD} --permission-mode acceptEdits"
elif [ "$PERM_MODE" = "bypassPermissions" ]; then
  CLAUDE_CMD="${CLAUDE_CMD} --dangerously-skip-permissions"
fi

# Read model routing from config
MODEL=$(python3 -c "
import json
try:
    cfg = json.load(open('${HOME}/.config/cockpit/config.json'))
    models = cfg.get('defaults', {}).get('models', {})
    print(models.get('$ROLE', ''))
except: print('')
" 2>/dev/null)

if [ -n "$MODEL" ]; then
  CLAUDE_CMD="${CLAUDE_CMD} --model ${MODEL}"
fi

# Append role template (slim — detailed instructions are in cockpit skills)
ROLE_FILE="${TEMPLATES_DIR}/${ROLE}.CLAUDE.md"
if [ -f "$ROLE_FILE" ]; then
  CLAUDE_CMD="${CLAUDE_CMD} --append-system-prompt-file ${ROLE_FILE}"
fi

# Load cockpit plugin for skills (captain-ops, command-ops, daily-log, etc.)
PLUGIN_DIR="${HOME}/.config/cockpit/plugin"
if [ -d "$PLUGIN_DIR" ]; then
  CLAUDE_CMD="${CLAUDE_CMD} --plugin-dir ${PLUGIN_DIR}"
fi

# --- Handle existing workspace ---
EXISTING_REF=$("$CMUX" list-workspaces 2>&1 | grep -F "$NAME" | awk '{print $1}' || true)
if [ -n "$EXISTING_REF" ] && [ "$FRESH" = "true" ]; then
  echo "Closing stale workspace: $NAME"
  "$CMUX" close-workspace --workspace "$EXISTING_REF" 2>/dev/null || true
  EXISTING_REF=""
fi

if [ -n "$EXISTING_REF" ]; then
  echo "Workspace '$NAME' already exists — switching to it"
  "$CMUX" select-workspace --workspace "$EXISTING_REF" 2>&1
  exit 0
fi

# --- Spawn new workspace ---
CURRENT=$("$CMUX" current-workspace 2>&1 | awk '{print $1}')
NEW_UUID=$("$CMUX" new-workspace --command "$CLAUDE_CMD" --cwd "$CWD" 2>&1 | awk '{print $2}')
"$CMUX" rename-workspace --workspace "$NEW_UUID" "$NAME" 2>&1
if [ "$ROLE" = "command" ] || [ "$ROLE" = "captain" ] || [ "$ROLE" = "reactor" ]; then
  "$CMUX" workspace-action --workspace "$NEW_UUID" --action pin 2>/dev/null || true
fi
# Send initial prompt to trigger startup checklist
if [ "$ROLE" = "captain" ]; then
  (sleep 3 && "$CMUX" send --workspace "$NEW_UUID" "Run your startup checklist: use the cockpit:captain-ops skill, complete all startup steps, then report ready." 2>/dev/null) &
elif [ "$ROLE" = "command" ]; then
  (sleep 3 && "$CMUX" send --workspace "$NEW_UUID" "Run your startup checklist: use the cockpit:command-ops skill, complete your daily briefing, then report ready." 2>/dev/null) &
elif [ "$ROLE" = "reactor" ]; then
  (sleep 3 && "$CMUX" send --workspace "$NEW_UUID" "Run your startup checklist: use the cockpit:reactor-ops skill, verify gh auth, read reactions.json, then start your poll loop." 2>/dev/null) &
fi

"$CMUX" select-workspace --workspace "$CURRENT" 2>&1
echo "Spawned workspace: $NAME at $CWD (role: $ROLE, fresh: $FRESH)"
