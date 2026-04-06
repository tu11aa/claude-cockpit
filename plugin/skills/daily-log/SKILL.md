---
name: daily-log
description: Write an end-of-day log to your spoke vault. Use when session ends or user says "end of day" / "wrap up".
---

# Daily Log

Write a daily log before your session ends.

## Setup

```bash
DATE=$(date +"%Y-%m-%d")
SPOKE_VAULT="{spokeVaultPath}"
mkdir -p "$SPOKE_VAULT/daily-logs"
```

## Write to `{spokeVaultPath}/daily-logs/YYYY-MM-DD.md`

```markdown
---
date: YYYY-MM-DD
project: {project-name}
---

# {project-name} — Daily Log

## Completed
- [tasks completed today]

## In Progress
- [tasks still being worked on]

## Blocked
- [anything stuck]

## Key Decisions
- [important decisions made today]

## Tomorrow
- [what should be picked up next]
```

This log is read by the command session to generate the morning briefing. Keep it concise — bullet points, not paragraphs.
