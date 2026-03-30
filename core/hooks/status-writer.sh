#!/bin/bash
# SessionEnd hook: updates spoke vault status to inactive
CONFIG_PATH="${HOME}/.config/cockpit/config.json"
if [ ! -f "$CONFIG_PATH" ]; then exit 0; fi
CWD=$(pwd)
SCRIPTS_DIR="${HOME}/.config/cockpit/scripts"
PROJECT_VAULT=$(python3 -c "
import json, os, sys
config = json.load(open(os.path.expanduser('$CONFIG_PATH')))
cwd = '$CWD'
for name, proj in config.get('projects', {}).items():
    proj_path = os.path.expanduser(proj['path'])
    if cwd.startswith(proj_path):
        print(os.path.expanduser(proj['spokeVault']))
        sys.exit(0)
" 2>/dev/null)
if [ -n "$PROJECT_VAULT" ] && [ -d "$PROJECT_VAULT" ]; then
  "$SCRIPTS_DIR/write-status.sh" "$PROJECT_VAULT" "captain_session" "inactive" "Captain session ended"
fi
