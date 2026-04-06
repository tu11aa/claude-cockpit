#!/bin/bash
# execute-reaction.sh — Execute a single reaction action
# Usage: execute-reaction.sh <action.json>
# Reads a single action object from file and executes it via cmux/gh.
set -euo pipefail

CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
CONFIG_FILE="${HOME}/.config/cockpit/config.json"
ACTION_FILE="${1:?Usage: execute-reaction.sh <action.json>}"

ACTION=$(cat "$ACTION_FILE")

# Parse action fields
ACTION_TYPE=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin)['action'])")
PROJECT=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('project',''))")
MESSAGE=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))")
NUMBER=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('number',''))")
URL=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))")
MERGE_METHOD=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('merge_method','squash'))")
PROJECT_STATUS=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('project_status',''))")
RULE=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('rule',''))")

# Look up captain workspace name for the project
get_captain_ws() {
  local proj="$1"
  CAPTAIN_NAME=$(python3 -c "
import json
cfg = json.load(open('$CONFIG_FILE'))
proj = cfg.get('projects', {}).get('$proj', {})
print(proj.get('captainName', ''))
")
  if [ -z "$CAPTAIN_NAME" ]; then
    echo "ERROR: No captain configured for project '$proj'" >&2
    return 1
  fi
  # Find workspace ref
  WS_REF=$("$CMUX" list-workspaces 2>&1 | grep -F "$CAPTAIN_NAME" | awk '{print $1}' || true)
  if [ -z "$WS_REF" ]; then
    echo "OFFLINE"
  else
    echo "$WS_REF"
  fi
}

get_command_ws() {
  COMMAND_NAME=$(python3 -c "
import json
cfg = json.load(open('$CONFIG_FILE'))
print(cfg.get('commandName', '🏛️ command'))
")
  WS_REF=$("$CMUX" list-workspaces 2>&1 | grep -F "$COMMAND_NAME" | awk '{print $1}' || true)
  echo "$WS_REF"
}

case "$ACTION_TYPE" in
  delegate-to-captain)
    WS=$(get_captain_ws "$PROJECT")
    if [ "$WS" = "OFFLINE" ]; then
      echo "⚠️  Captain for '$PROJECT' is offline. Spawning..."
      # Spawn captain via cockpit launch
      cockpit launch "$PROJECT" 2>/dev/null || true
      sleep 5
      WS=$(get_captain_ws "$PROJECT")
    fi
    if [ -n "$WS" ] && [ "$WS" != "OFFLINE" ]; then
      "$CMUX" send --workspace "$WS" "$MESSAGE"
      "$CMUX" send-key --workspace "$WS" Enter
      echo "✔ Delegated issue #${NUMBER} to ${PROJECT} captain"
    else
      echo "✘ Could not reach captain for '$PROJECT'" >&2
      exit 1
    fi
    ;;

  send-to-captain)
    WS=$(get_captain_ws "$PROJECT")
    if [ -n "$WS" ] && [ "$WS" != "OFFLINE" ]; then
      "$CMUX" send --workspace "$WS" "$MESSAGE"
      "$CMUX" send-key --workspace "$WS" Enter
      echo "✔ Sent message to ${PROJECT} captain: ${RULE}"
    else
      echo "⚠️  Captain for '$PROJECT' offline — escalating to command"
      # Fallback: send to command
      CMD_WS=$(get_command_ws)
      if [ -n "$CMD_WS" ]; then
        "$CMUX" send --workspace "$CMD_WS" "⚠️ Reactor: ${PROJECT} captain offline. Pending action: ${MESSAGE}"
        "$CMUX" send-key --workspace "$CMD_WS" Enter
      fi
    fi
    ;;

  auto-merge)
    # Get repo info from reactions config
    REPO_INFO=$(python3 -c "
import json
with open('${HOME}/.config/cockpit/reactions.json') as f:
    cfg = json.load(f)
repos = cfg.get('github', {}).get('repos', {})
r = repos.get('$PROJECT', {})
print(f\"{r.get('owner','')}/{r.get('repo','')}\")
")
    if [ -n "$REPO_INFO" ] && [ "$REPO_INFO" != "/" ]; then
      gh pr merge "$NUMBER" --repo "$REPO_INFO" --"$MERGE_METHOD" --auto 2>&1
      echo "✔ Auto-merge enabled for PR #${NUMBER} on ${REPO_INFO} (${MERGE_METHOD})"
    else
      echo "✘ No repo configured for project '$PROJECT'" >&2
      exit 1
    fi
    ;;

  escalate)
    CMD_WS=$(get_command_ws)
    if [ -n "$CMD_WS" ]; then
      "$CMUX" send --workspace "$CMD_WS" "$MESSAGE"
      "$CMUX" send-key --workspace "$CMD_WS" Enter
      echo "✔ Escalated to command: ${RULE}"
    else
      # Last resort: print to reactor log
      echo "⚠️  Command workspace offline. Escalation: ${MESSAGE}"
    fi
    ;;

  update-project-status)
    # Update GitHub Project card status
    REACTIONS_FILE="${HOME}/.config/cockpit/reactions.json"
    PROJECT_CFG=$(python3 -c "
import json
with open('$REACTIONS_FILE') as f:
    cfg = json.load(f)
proj = cfg.get('github', {}).get('project')
if proj:
    print(json.dumps(proj))
else:
    print('null')
")
    if [ "$PROJECT_CFG" != "null" ] && [ -n "$PROJECT_STATUS" ]; then
      echo "ℹ️  Project status update: ${PROJECT_STATUS} (GitHub Project updates require manual setup)"
      # TODO: Implement gh project item-edit when project item IDs are tracked
    fi
    ;;

  send-to-command)
    CMD_WS=$(get_command_ws)
    if [ -n "$CMD_WS" ]; then
      "$CMUX" send --workspace "$CMD_WS" "$MESSAGE"
      "$CMUX" send-key --workspace "$CMD_WS" Enter
      echo "✔ Sent to command: ${RULE}"
    fi
    ;;

  *)
    echo "✘ Unknown action type: $ACTION_TYPE" >&2
    exit 1
    ;;
esac
