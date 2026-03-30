---
title: Command Center
---

# Command Center

## Projects

```dataview
TABLE captain_session as "Status", active_crew as "Crew",
  tasks_completed + "/" + tasks_total as "Progress", last_updated as "Updated"
FROM "projects"
SORT last_updated DESC
```

## Pending Enhancements

```dataview
TABLE project, category, date
FROM "learnings"
WHERE applied = false
SORT date DESC
```
