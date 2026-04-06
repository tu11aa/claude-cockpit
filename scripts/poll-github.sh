#!/bin/bash
# poll-github.sh — Fetch GitHub events for all configured repos
# Usage: poll-github.sh [reactions.json path]
# Output: JSON array of events to stdout
#
# Requires: gh CLI authenticated
set -euo pipefail

REACTIONS_FILE="${1:-${HOME}/.config/cockpit/reactions.json}"
CONFIG_FILE="${HOME}/.config/cockpit/config.json"

if ! command -v gh &>/dev/null; then
  echo '{"error": "gh CLI not found. Install: https://cli.github.com"}' >&2
  exit 1
fi

if ! gh auth status &>/dev/null 2>&1; then
  echo '{"error": "gh CLI not authenticated. Run: gh auth login"}' >&2
  exit 1
fi

# Parse repos from reactions.json
REPOS=$(python3 -c "
import json, sys
try:
    with open('$REACTIONS_FILE') as f:
        cfg = json.load(f)
    repos = cfg.get('github', {}).get('repos', {}) or {}
    print(json.dumps(repos))
except Exception as e:
    print('{}', file=sys.stdout)
    print(f'Warning: {e}', file=sys.stderr)
")

if [ "$REPOS" = "{}" ]; then
  echo "[]"
  exit 0
fi

# Map cockpit project names to repos
PROJECT_NAMES=$(echo "$REPOS" | python3 -c "
import json, sys
repos = json.load(sys.stdin)
for name, cfg in repos.items():
    print(f\"{name}|{cfg['owner']}/{cfg['repo']}\")
")

EVENTS="[]"

while IFS='|' read -r PROJECT_NAME FULL_REPO; do
  [ -z "$PROJECT_NAME" ] && continue
  OWNER="${FULL_REPO%%/*}"
  REPO="${FULL_REPO##*/}"

  # --- Poll Issues ---
  ISSUES=$(gh api "repos/${OWNER}/${REPO}/issues" \
    --jq '[.[] | select(.pull_request == null) | {
      type: "issue",
      project: "'"$PROJECT_NAME"'",
      repo: "'"$FULL_REPO"'",
      number: .number,
      title: .title,
      body: (.body // "" | .[0:500]),
      state: .state,
      labels: [.labels[].name],
      assignees: [.assignees[].login],
      url: .html_url,
      created_at: .created_at,
      updated_at: .updated_at
    }]' 2>/dev/null || echo '[]')

  # --- Poll Pull Requests ---
  PRS=$(gh api "repos/${OWNER}/${REPO}/pulls?state=open" \
    --jq '[.[] | {
      type: "pr",
      project: "'"$PROJECT_NAME"'",
      repo: "'"$FULL_REPO"'",
      number: .number,
      title: .title,
      body: (.body // "" | .[0:300]),
      state: .state,
      head_branch: .head.ref,
      base_branch: .base.ref,
      draft: .draft,
      labels: [.labels[].name],
      url: .html_url,
      created_at: .created_at,
      updated_at: .updated_at
    }]' 2>/dev/null || echo '[]')

  # For each PR, get check status and review decision
  PR_NUMBERS=$(echo "$PRS" | python3 -c "
import json, sys
prs = json.load(sys.stdin)
for pr in prs:
    print(pr['number'])
" 2>/dev/null)

  ENRICHED_PRS="$PRS"
  while read -r PR_NUM; do
    [ -z "$PR_NUM" ] && continue

    # Get combined check status
    CHECK_STATUS=$(gh api "repos/${OWNER}/${REPO}/commits/$(gh api "repos/${OWNER}/${REPO}/pulls/${PR_NUM}" --jq '.head.sha' 2>/dev/null)/check-runs" \
      --jq '{
        total: .total_count,
        success: [.check_runs[] | select(.conclusion == "success")] | length,
        failure: [.check_runs[] | select(.conclusion == "failure")] | length,
        pending: [.check_runs[] | select(.status == "in_progress" or .status == "queued")] | length
      }' 2>/dev/null || echo '{"total":0,"success":0,"failure":0,"pending":0}')

    # Get review decision
    REVIEWS=$(gh api "repos/${OWNER}/${REPO}/pulls/${PR_NUM}/reviews" \
      --jq '[.[] | {state: .state, user: .user.login}] | last // {state: "PENDING"}' 2>/dev/null || echo '{"state":"PENDING"}')

    # Enrich PR with check + review info
    ENRICHED_PRS=$(echo "$ENRICHED_PRS" | python3 -c "
import json, sys
prs = json.load(sys.stdin)
checks = json.loads('$CHECK_STATUS')
review = json.loads('$REVIEWS')
for pr in prs:
    if pr['number'] == $PR_NUM:
        pr['checks'] = checks
        # Derive overall check status
        if checks.get('failure', 0) > 0:
            pr['checks_status'] = 'failure'
        elif checks.get('pending', 0) > 0:
            pr['checks_status'] = 'pending'
        elif checks.get('success', 0) > 0:
            pr['checks_status'] = 'success'
        else:
            pr['checks_status'] = 'none'
        pr['review_state'] = review.get('state', 'PENDING').lower()
        # Map GitHub review states to our trigger values
        state_map = {
            'approved': 'approved',
            'changes_requested': 'changes_requested',
            'commented': 'commented',
            'pending': 'review_required',
            'dismissed': 'review_required'
        }
        pr['review_decision'] = state_map.get(pr['review_state'], 'review_required')
print(json.dumps(prs))
")
  done <<< "$PR_NUMBERS"

  # Merge into events array
  EVENTS=$(python3 -c "
import json
events = json.loads('$(echo "$EVENTS" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")')
issues = json.loads('''$ISSUES''')
prs = json.loads('''$ENRICHED_PRS''')
events.extend(issues)
events.extend(prs)
print(json.dumps(events))
")

done <<< "$PROJECT_NAMES"

# --- Poll GitHub Project board (if configured) ---
PROJECT_CFG=$(python3 -c "
import json
try:
    with open('$REACTIONS_FILE') as f:
        cfg = json.load(f)
    proj = cfg.get('github', {}).get('project')
    if proj:
        print(json.dumps(proj))
    else:
        print('null')
except:
    print('null')
")

if [ "$PROJECT_CFG" != "null" ]; then
  PROJ_OWNER=$(echo "$PROJECT_CFG" | python3 -c "import json,sys; print(json.load(sys.stdin)['owner'])")
  PROJ_NUMBER=$(echo "$PROJECT_CFG" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")

  # Fetch project items via GraphQL
  PROJECT_ITEMS=$(gh api graphql -f query='
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          items(first: 50) {
            nodes {
              id
              content {
                ... on Issue {
                  number
                  title
                  repository { nameWithOwner }
                  url
                }
                ... on PullRequest {
                  number
                  title
                  repository { nameWithOwner }
                  url
                }
              }
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                }
              }
            }
          }
        }
      }
    }
  ' -f owner="$PROJ_OWNER" -F number="$PROJ_NUMBER" 2>/dev/null || echo '{"data":null}')

  # Parse project items into events
  PROJECT_EVENTS=$(echo "$PROJECT_ITEMS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = []
try:
    nodes = data['data']['user']['projectV2']['items']['nodes']
    for node in nodes:
        content = node.get('content')
        if not content:
            continue
        status_field = node.get('fieldValueByName') or {}
        status = status_field.get('name', 'No Status')
        items.append({
            'type': 'project-card',
            'project_item_id': node['id'],
            'number': content.get('number'),
            'title': content.get('title'),
            'repo': (content.get('repository') or {}).get('nameWithOwner', ''),
            'url': content.get('url', ''),
            'project_status': status
        })
except (KeyError, TypeError):
    pass
print(json.dumps(items))
")

  EVENTS=$(python3 -c "
import json
events = json.loads('$(echo "$EVENTS" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")')
cards = json.loads('''$PROJECT_EVENTS''')
events.extend(cards)
print(json.dumps(events))
")
fi

# Output final events
echo "$EVENTS" | python3 -m json.tool
