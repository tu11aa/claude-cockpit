---
name: command-ops
description: Complete command playbook — daily briefing, delegation workflow, project registration, status checking, and learnings review. Use at session start and reference throughout.
---

# Command Operations

## Daily Briefing (Session Start)

Run when session starts, or user says "morning", "catch up", "summary":

1. **Check handoffs from all projects** (context from yesterday's sessions):
```bash
for vault in $(cat ~/.config/cockpit/config.json | python3 -c "import json,sys; [print(p['spokeVault']) for p in json.loads(sys.stdin.read())['projects'].values()]"); do
  echo "=== $(basename $vault) ==="
  ~/.config/cockpit/scripts/read-handoff.sh "$vault" --keep
done
```
Handoffs contain: currentState, openBranches, nextSteps, blockedItems, decisions. Use these to understand where each project left off.

2. Search **claude-mem** (`mem-search` skill) for recent activity across all projects.
3. Read yesterday's logs:
```bash
YESTERDAY=$(date -v-1d +"%Y-%m-%d")
for vault in $(cat ~/.config/cockpit/config.json | python3 -c "import json,sys; [print(p['spokeVault']) for p in json.loads(sys.stdin.read())['projects'].values()]"); do
  echo "=== $vault ==="
  cat "$vault/daily-logs/${YESTERDAY}.md" 2>/dev/null || echo "(no log)"
done
```
4. Read current status: `~/.config/cockpit/scripts/read-status.sh`
5. Run quick standup for context: `cockpit standup --yesterday --raw`
6. Present briefing, then save to `{hubVault}/daily-logs/YYYY-MM-DD.md`

## Delegation Workflow

When the user gives a task for a project:

### 1. Identify project
Match to `~/.config/cockpit/config.json`.

### 2. Check for captain workspace
```bash
/Applications/cmux.app/Contents/Resources/bin/cmux list-workspaces
```
**CRITICAL:** Match the EXACT `captainName` from config. `Brove` ≠ `⚓ brove-captain`.

### 3. Spawn captain if missing
```bash
~/.config/cockpit/scripts/spawn-workspace.sh "{captainName}" "{projectPath}"
```
Wait a few seconds, then `list-workspaces` again to get its ref.

### 4. Send the task
```bash
/Applications/cmux.app/Contents/Resources/bin/cmux send --workspace "workspace:N" "Task description with all context"
/Applications/cmux.app/Contents/Resources/bin/cmux send-key --workspace "workspace:N" Enter
```

### 5. Report back
"Delegated to {captainName}."

## Checking Status

```bash
~/.config/cockpit/scripts/read-status.sh
```
Or read a captain's screen:
```bash
/Applications/cmux.app/Contents/Resources/bin/cmux read-screen --workspace "workspace:N"
```

## Registering Projects

1. Explore directory: `find {path} -maxdepth 2 -name ".git" -type d`
2. Identify primary repo (most active, main application)
3. Identify siblings (docs, sites, forks)
4. Register with groups:
```bash
cockpit projects add {name} {path/to/repo} --group {group}
cockpit projects add {name}-docs {path/to/docs} --group {group} --group-role "documentation site"
```
5. Confirm with user. Always register the `.git` directory, not the parent.

## Monitoring Captains

Captains will send you reports via `cmux send` when tasks complete or blockers arise. When you receive a captain report:

1. Acknowledge the report
2. Update your dashboard / briefing notes
3. If the captain reported a blocker — escalate to the user
4. If all tasks for a project are done — inform the user

You can also **proactively check** captain progress:
```bash
# Read all captain statuses at once
for vault in $(cat ~/.config/cockpit/config.json | python3 -c "import json,sys; [print(p['spokeVault']) for p in json.loads(sys.stdin.read())['projects'].values()]"); do
  echo "=== $(basename $vault) ==="
  head -15 "$vault/status.md" 2>/dev/null || echo "(no status)"
done
```

Do this when:
- The user asks for a status update
- A captain hasn't reported back in a while
- Before your daily briefing

## Reactor Awareness

The **reactor** is an always-on workspace that polls GitHub and captain status automatically. It handles:
- Auto-delegating issues labeled "ready" to captains
- Sending CI failure notifications to captains
- Escalating stale captains or blockers to you
- Updating GitHub Project board cards

You'll receive messages from the reactor like:
- "⚡ Reactor online. Polling every 5m. Watching N repos."
- "⚠️ {project} captain hasn't updated in 2h"
- "🚫 {project} captain is blocked: {message}"

When the reactor escalates to you:
1. Check the captain's status via `cmux read-screen`
2. If captain is stuck, send them guidance
3. If captain is offline, restart them: `cockpit launch <project>`
4. Acknowledge the escalation so it doesn't re-trigger

Check reactor state: `cockpit reactor status`
Run a manual cycle: `cockpit reactor check`

## Reviewing Learnings

1. Scan `{spokeVault}/learnings/*.md` where `applied: false`
2. Group by category, identify cross-project patterns
3. If same issue in 2+ projects → propose a **captured skill**
4. If a skill keeps failing → propose a **fix**
5. Propose specific changes to the user
6. After approval, apply and mark `applied: true`
