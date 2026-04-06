#!/bin/bash
# match-reactions.sh — Match polled events against reaction rules
# Usage: match-reactions.sh <events.json> [reactions.json]
# Output: JSON array of actions to execute
#
# Tracks processed events in reactor-state.json to avoid duplicates.
set -euo pipefail

EVENTS_FILE="${1:?Usage: match-reactions.sh <events.json> [reactions.json]}"
REACTIONS_FILE="${2:-${HOME}/.config/cockpit/reactions.json}"
STATE_FILE="${HOME}/.config/cockpit/reactor-state.json"

# Ensure state file exists
if [ ! -f "$STATE_FILE" ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  echo '{"processed_events": {}, "pending_retries": {}, "last_poll": null}' > "$STATE_FILE"
fi

EVENTS_FILE="$EVENTS_FILE" REACTIONS_FILE="$REACTIONS_FILE" STATE_FILE="$STATE_FILE" python3 << 'PYEOF'
import json, sys, os, re
from datetime import datetime, timedelta, timezone

EVENTS_FILE = os.environ["EVENTS_FILE"]
REACTIONS_FILE = os.environ["REACTIONS_FILE"]
STATE_FILE = os.environ["STATE_FILE"]

# Load inputs
with open(EVENTS_FILE) as f:
    events = json.load(f) if os.path.getsize(EVENTS_FILE) > 0 else []

with open(REACTIONS_FILE) as f:
    config = json.load(f)

with open(STATE_FILE) as f:
    state = json.load(f)

reactions = config.get("reactions", {})
processed = state.get("processed_events", {})
pending_retries = state.get("pending_retries", {})
actions = []

def parse_duration(s):
    """Parse '2h', '30m', '1d' into timedelta."""
    if not s:
        return None
    m = re.match(r"(\d+)(m|h|d)", str(s))
    if not m:
        return None
    val, unit = int(m.group(1)), m.group(2)
    if unit == "m": return timedelta(minutes=val)
    if unit == "h": return timedelta(hours=val)
    if unit == "d": return timedelta(days=val)
    return None

def event_key(event):
    """Generate a unique key for an event to track processing."""
    etype = event.get("type", "unknown")
    project = event.get("project", "")
    number = event.get("number", "")
    # For PRs, include check/review state so we re-trigger on state changes
    if etype == "pr":
        checks = event.get("checks_status", "")
        review = event.get("review_decision", "")
        return f"{etype}:{project}:{number}:{checks}:{review}"
    return f"{etype}:{project}:{number}"

def matches_trigger(event, trigger, rule_source):
    """Check if an event matches a reaction trigger."""
    etype = event.get("type", "")

    # Source type must match
    if rule_source == "github-issues" and etype != "issue":
        return False
    if rule_source == "github-prs" and etype != "pr":
        return False
    if rule_source == "captain-status" and etype != "captain-status":
        return False

    # Label match
    if "label" in trigger:
        labels = event.get("labels", [])
        if trigger["label"] not in labels:
            return False

    # State match
    if "state" in trigger:
        if event.get("state") != trigger["state"]:
            return False

    # Not assigned check
    if trigger.get("not_assigned"):
        assignees = event.get("assignees", [])
        if len(assignees) > 0:
            return False

    # Checks status match
    if "checks" in trigger:
        if event.get("checks_status") != trigger["checks"]:
            return False

    # Review decision match
    if "review_decision" in trigger:
        if event.get("review_decision") != trigger["review_decision"]:
            return False

    # Captain status: no_update_for
    if "no_update_for" in trigger:
        last_updated = event.get("last_updated")
        if last_updated:
            try:
                dt = datetime.fromisoformat(last_updated.replace("Z", "+00:00"))
                threshold = parse_duration(trigger["no_update_for"])
                if threshold and (datetime.now(timezone.utc) - dt) < threshold:
                    return False
            except:
                return False
        else:
            return False

    # Captain status: status_contains
    if "status_contains" in trigger:
        msg = event.get("status_message", "").lower()
        if trigger["status_contains"].lower() not in msg:
            return False

    # Captain status: event type
    if "event" in trigger:
        if event.get("event") != trigger["event"]:
            return False

    return True

def interpolate_message(template, event):
    """Replace {placeholders} in message with event data."""
    if not template:
        return ""
    result = template
    for key, val in event.items():
        if isinstance(val, (str, int, float)):
            result = result.replace("{" + key + "}", str(val))
        elif isinstance(val, list):
            result = result.replace("{" + key + "}", ", ".join(str(v) for v in val))
    return result

# Match events against reactions
now = datetime.now(timezone.utc).isoformat()

for event in events:
    key = event_key(event)

    for rule_name, rule in reactions.items():
        if not rule.get("enabled", True):
            continue

        if not matches_trigger(event, rule.get("trigger", {}), rule.get("source", "")):
            continue

        # Check if already processed (same event+rule combo)
        action_key = f"{key}:{rule_name}"
        if action_key in processed:
            continue

        # Build action
        action = {
            "rule": rule_name,
            "action": rule["action"],
            "project": event.get("project", ""),
            "event_type": event.get("type", ""),
            "number": event.get("number"),
            "title": event.get("title", ""),
            "url": event.get("url", ""),
            "message": interpolate_message(rule.get("message", ""), event),
            "priority": rule.get("priority", "normal"),
            "project_status": rule.get("project_status"),
            "merge_method": rule.get("merge_method"),
            "retries": rule.get("retries", config.get("engine", {}).get("max_retries", 2)),
            "escalate_after": rule.get("escalate_after"),
            "timestamp": now,
        }
        actions.append(action)

        # Mark as processed
        processed[action_key] = now

# Update state
state["processed_events"] = processed
state["last_poll"] = now

# Prune old processed events (older than 7 days)
cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
state["processed_events"] = {
    k: v for k, v in processed.items()
    if v > cutoff
}

with open(STATE_FILE, "w") as f:
    json.dump(state, f, indent=2)

print(json.dumps(actions, indent=2))
PYEOF
