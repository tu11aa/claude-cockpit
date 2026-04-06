---
name: reactor-ops
description: Complete reactor playbook — GitHub polling, reaction matching, action execution, GitHub Projects integration, and poll loop management. Use at session start.
---

# Reactor Operations

## Session Startup

1. Verify `gh` CLI is authenticated:
```bash
gh auth status
```

2. Read reactions config:
```bash
cat ~/.config/cockpit/reactions.json
```

3. Read cockpit config to know all projects:
```bash
cat ~/.config/cockpit/config.json
```

4. Check reactor state (last poll time, processed events):
```bash
cat ~/.config/cockpit/reactor-state.json 2>/dev/null || echo "First run"
```

5. Report ready to command:
```bash
CMD_WS=$(/Applications/cmux.app/Contents/Resources/bin/cmux list-workspaces 2>&1 | grep '🏛️ command' | awk '{print $1}')
if [ -n "$CMD_WS" ]; then
  /Applications/cmux.app/Contents/Resources/bin/cmux send --workspace "$CMD_WS" "⚡ Reactor online. Polling every $(python3 -c "import json; print(json.load(open('$HOME/.config/cockpit/reactions.json')).get('engine',{}).get('poll_interval','5m'))" 2>/dev/null). Watching $(python3 -c "import json; cfg=json.load(open('$HOME/.config/cockpit/reactions.json')); print(len(cfg.get('github',{}).get('repos',{}) or {}))" 2>/dev/null) repos."
  /Applications/cmux.app/Contents/Resources/bin/cmux send-key --workspace "$CMD_WS" Enter
fi
```

## Poll Loop

Run one cycle immediately on startup, then repeat on the configured interval.

### Quick Cycle (single command)

```bash
~/.config/cockpit/scripts/reactor-cycle.sh
```

This runs: poll GitHub → poll captain status → match reactions → execute actions.

### Manual Step-by-Step (for debugging)

If the quick cycle fails or you need to debug:

**Step 1 — Poll GitHub:**
```bash
~/.config/cockpit/scripts/poll-github.sh > /tmp/reactor-events.json
cat /tmp/reactor-events.json | python3 -m json.tool | head -50
```

**Step 2 — Match reactions:**
```bash
~/.config/cockpit/scripts/match-reactions.sh /tmp/reactor-events.json > /tmp/reactor-actions.json
cat /tmp/reactor-actions.json | python3 -m json.tool
```

**Step 3 — Execute each action:**
```bash
# For each action in the array:
echo '<action json>' > /tmp/action.json
~/.config/cockpit/scripts/execute-reaction.sh /tmp/action.json
```

## Action Types

### delegate-to-captain
- Finds the project's captain workspace via cmux
- If captain is offline, spawns it via `cockpit launch <project>`
- Sends the issue details as a task message
- Captain will pick it up and spawn crew

### send-to-captain
- Sends a message to an existing captain (CI failure, review feedback)
- If captain is offline, escalates to command instead

### auto-merge
- Runs `gh pr merge` with the configured method (squash/merge/rebase)
- Only triggers when both `review: approved` AND `checks: success`
- Disabled by default — user must opt in via reactions.json

### escalate
- Sends a message to the command workspace
- Used for stale captains, blockers, and offline fallbacks
- If command is also offline, logs to reactor output

### update-project-status
- Updates a GitHub Project card status (Ready → In Progress → Review → Done)
- Requires GitHub Project to be configured in reactions.json

### send-to-command
- Sends an informational message to command
- Used for scheduled notifications (daily briefing trigger, etc.)

## GitHub Projects Integration

If `github.project` is configured in reactions.json, the reactor can:

### Read project board
```bash
gh project item-list <number> --owner <owner> --format json
```

### Update card status
```bash
gh project item-edit --project-id <id> --id <item-id> --field-id <status-field-id> --single-select-option-id <option-id>
```

### Workflow
1. User creates issue, adds to project board in "Backlog"
2. User moves to "Ready" column (or labels "ready")
3. **Reactor detects** → delegates to captain → moves card to "In Progress"
4. Captain completes task → reports done
5. **Reactor detects** completion → moves card to "Review"
6. PR approved + merged → **Reactor moves** card to "Done"

## Handling Failures

### Captain offline when delegating
1. Try to spawn captain: `cockpit launch <project>`
2. Wait 5 seconds, retry
3. If still offline → escalate to command

### Duplicate event prevention
- Each event gets a unique key: `{type}:{project}:{number}:{state}`
- Processed events are tracked in `~/.config/cockpit/reactor-state.json`
- Events older than 7 days are pruned automatically
- PR events include check/review state in the key, so state changes re-trigger

### Retries
- Actions have a `retries` count (default: 2 from engine config)
- If execution fails, decrement retry count and re-queue for next cycle
- After all retries exhausted → escalate to command

## Monitoring Your Own State

After each cycle, report a summary:
```bash
echo "Reactor cycle: $(date '+%H:%M') — polled $(EVENT_COUNT) events, matched $(ACTION_COUNT) actions"
```

If you detect anomalies:
- Too many events (>50) → possible API issue, log warning
- Same action repeating → check if state file is being written correctly
- All captains stale → escalate to command with full status summary

## Keeping the Loop Running

Use the cockpit `/loop` skill to maintain your poll interval. Between cycles:
- Check if new reactions.json has been deployed (file modification time)
- If config changed, reload it before next cycle
- Stay responsive to messages from command (they may send you manual triggers)
