# Learnings — Self-Enhancement Instructions

This document instructs agents on how to record and review learnings for continuous improvement.

## When to Record a Learning

Record after:
- A task completes (what went well, what didn't)
- An unexpected issue was encountered
- A workaround was needed for a tool limitation
- A pattern was discovered that could help future tasks
- A CLAUDE.md instruction was unclear or missing

## Categories

- `workflow` — process improvements, task management
- `template` — vault template or file format improvements
- `convention` — naming, structure, or organization suggestions
- `bug` — tool bugs or unexpected behaviors
- `insight` — domain knowledge or architectural understanding

## How to Record

```bash
~/.config/cockpit/scripts/record-learning.sh "{spokeVaultPath}" "{category}" "{description and suggestion}"
```

## For the Command Session: Reviewing Learnings

1. Periodically scan all spoke vaults for unapplied learnings
2. Group by category and identify patterns
3. If the same issue appears across 2+ projects, flag it as systemic
4. Propose specific changes (which file, what to change, why)
5. Present to user for approval
6. After approval, apply the change and mark the learning as `applied: true`
