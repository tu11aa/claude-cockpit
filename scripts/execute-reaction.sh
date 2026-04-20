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
MAX_RETRIES=$(echo "$ACTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('retries', 2))")

STATE_FILE="${HOME}/.config/cockpit/reactor-state.json"

# Retry counter helpers — keyed by project#number (e.g. "cockpit#16")
get_retry_count() {
  local key="$1"
  [ -f "$STATE_FILE" ] || { echo 0; return; }
  python3 -c "
import json
s = json.load(open('$STATE_FILE'))
print(s.get('retry_counters', {}).get('$key', 0))
"
}

incr_retry_count() {
  local key="$1"
  python3 -c "
import json, os
path = '$STATE_FILE'
s = json.load(open(path)) if os.path.exists(path) else {}
rc = s.setdefault('retry_counters', {})
rc['$key'] = rc.get('$key', 0) + 1
json.dump(s, open(path, 'w'), indent=2)
print(rc['$key'])
"
}

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

  auto-fix-ci)
    # CI failed on a PR — re-delegate to captain with failure logs, or escalate after max retries.
    RETRY_KEY="${PROJECT}#${NUMBER}"
    CURRENT=$(get_retry_count "$RETRY_KEY")

    if [ "$CURRENT" -ge "$MAX_RETRIES" ]; then
      # Escalate to command
      CMD_WS=$(get_command_ws)
      ESC_MSG="🚨 CI failed ${CURRENT}× on ${PROJECT} PR #${NUMBER} — auto-fix exhausted (max ${MAX_RETRIES}). Needs manual triage: ${URL}"
      if [ -n "$CMD_WS" ]; then
        "$CMUX" send --workspace "$CMD_WS" "$ESC_MSG"
        "$CMUX" send-key --workspace "$CMD_WS" Enter
        echo "✔ Escalated PR #${NUMBER} to command (retries: ${CURRENT}/${MAX_RETRIES})"
      else
        echo "⚠️  Command offline. Escalation: ${ESC_MSG}"
      fi
      exit 0
    fi

    # Resolve repo for log fetching
    REPO_INFO=$(python3 -c "
import json
with open('${HOME}/.config/cockpit/reactions.json') as f:
    cfg = json.load(f)
repos = cfg.get('github', {}).get('repos', {})
r = repos.get('$PROJECT', {})
print(f\"{r.get('owner','')}/{r.get('repo','')}\")
")
    if [ -z "$REPO_INFO" ] || [ "$REPO_INFO" = "/" ]; then
      echo "✘ No repo configured for project '$PROJECT'" >&2
      exit 1
    fi

    # Fetch failed check names + log tail for the PR's head commit
    FAIL_SUMMARY=$(gh pr checks "$NUMBER" --repo "$REPO_INFO" 2>/dev/null | awk -F'\t' '$2=="fail"{print "- "$1" ("$4")"}' | head -20 || true)
    FAIL_RUN_ID=$(gh pr checks "$NUMBER" --repo "$REPO_INFO" --json name,state,link 2>/dev/null \
      | python3 -c "
import json, sys, re
try:
    checks = json.load(sys.stdin)
    for c in checks:
        if c.get('state') == 'FAILURE':
            m = re.search(r'/runs/(\d+)', c.get('link',''))
            if m:
                print(m.group(1)); break
except Exception:
    pass
" 2>/dev/null || true)

    LOG_TAIL=""
    if [ -n "$FAIL_RUN_ID" ]; then
      LOG_TAIL=$(gh run view "$FAIL_RUN_ID" --repo "$REPO_INFO" --log-failed 2>/dev/null | tail -100 || true)
    fi

    # Build captain prompt
    CAPTAIN_PROMPT="🔧 Auto-fix CI — ${PROJECT} PR #${NUMBER} (attempt $((CURRENT+1))/${MAX_RETRIES})
${URL}

Failing checks:
${FAIL_SUMMARY:-(details unavailable)}

Failed job log tail:
\`\`\`
${LOG_TAIL:-(log unavailable)}
\`\`\`

Spawn a crew: checkout the PR branch, diagnose the failure, apply a fix, commit, and push. If the cause is unclear or outside the PR scope, reply here so I can escalate to command."

    WS=$(get_captain_ws "$PROJECT")
    if [ "$WS" = "OFFLINE" ]; then
      echo "⚠️  Captain for '$PROJECT' offline. Spawning..."
      cockpit launch "$PROJECT" 2>/dev/null || true
      sleep 5
      WS=$(get_captain_ws "$PROJECT")
    fi

    if [ -n "$WS" ] && [ "$WS" != "OFFLINE" ]; then
      "$CMUX" send --workspace "$WS" "$CAPTAIN_PROMPT"
      "$CMUX" send-key --workspace "$WS" Enter
      NEW_COUNT=$(incr_retry_count "$RETRY_KEY")
      echo "✔ Auto-fix dispatched to ${PROJECT} captain (attempt ${NEW_COUNT}/${MAX_RETRIES})"
    else
      echo "✘ Could not reach captain for '$PROJECT'" >&2
      exit 1
    fi
    ;;

  *)
    echo "✘ Unknown action type: $ACTION_TYPE" >&2
    exit 1
    ;;
esac
