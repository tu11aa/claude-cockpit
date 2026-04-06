---
name: captain-ops
description: Complete captain playbook — session startup, crew spawning, status writing, group awareness, and learnings. Use this skill at session start and reference it throughout.
---

# Captain Operations

## Session Startup

1. Read `~/.config/cockpit/config.json` — match your current working directory. Note your `spokeVault`, `group`, `groupRole`, and `maxCrew` (default: 5).
2. Search **claude-mem** (`mem-search` skill) for your project name to get continuity from previous sessions.
3. Check `{spokeVault}/daily-logs/` — read the most recent log if one exists.
4. Check `{spokeVault}/learnings/` — **selectively** load relevant learnings (see "Selective Loading" section below). Do NOT read all files — grep by task keywords and tags.
5. Check `{spokeVault}/skills/` — if any captured skills match your current task, load them for crew reference.
6. Write active status:
```bash
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "captain_session" "active" "Captain session started"
```

## Setting Up Your Team

On session start (or when you receive your first task), create an Agent Team:
```
TeamCreate(team_name: "{project}-crew", description: "Crew for {project}")
```

This gives you persistent crew members, shared task lists, and mid-task messaging.

## Spawning Crew

**You MUST spawn a crew member for ANY coding task** — even a one-line change. You are a coordinator. You plan, delegate, review, and merge. You do NOT write code yourself.

Use the **Agent tool** with `team_name` and `isolation: "worktree"`:
```
Agent(
  team_name: "{project}-crew",
  name: "🔧 {project}-crew-{task}",
  isolation: "worktree",
  prompt: "You are a crew member on {project}. Your task: {description}. Branch from: {branch}. Files involved: {files}."
)
```

- Do **NOT** manually run `git worktree add`
- Do **NOT** edit source code yourself — always delegate to crew
- Respect `maxCrew` limit
- Give clear context: what to change, which files, which branch to base from
- Crew members **persist** — you can send follow-up instructions via `SendMessage(to: "🔧 {project}-crew-{task}", message: "...")`

## Task Coordination

Use **TaskCreate** to create tasks and **TaskUpdate** to assign them to crew:
```
TaskCreate(title: "Add preinstall hook", description: "...")
TaskUpdate(task_id: "...", owner: "🔧 brove-crew-preinstall", status: "in_progress")
```

- Check **TaskList** periodically to track progress
- Crew members mark their own tasks completed via TaskUpdate
- When crew goes idle after sending you a message, that's normal — they're waiting for input

## Writing Status

Update after **EVERY** event using:
```bash
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "{field}" "{value}" "{message}"
```

| Event | field | value | message |
|---|---|---|---|
| Received task | `tasks_total` / `tasks_pending` | `1` | `Received: {desc}` |
| Spawned crew | `active_crew` / `tasks_in_progress` | `1` | `Spawned crew for {task}` |
| Task done | `tasks_completed` / `tasks_in_progress` | `1` / `0` | `Completed: {desc}` |

## When Crew Finishes — MANDATORY CLOSE-OUT

**You MUST complete ALL of these steps after every task. Do NOT skip any.**

1. Review their work (read the diff, check the branch)
2. Merge their branch if appropriate
3. Dismiss crew: `SendMessage(to: "crew-name", message: {"type": "shutdown_request"})`
4. **Update status — set active_crew back to 0:**
```bash
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "active_crew" "0" "Completed: {task description}"
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "tasks_in_progress" "0" ""
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "tasks_completed" "{N}" ""
```
5. Record learnings if any
6. **Report to command — THIS IS REQUIRED:**
```bash
CMD_WS=$(/Applications/cmux.app/Contents/Resources/bin/cmux list-workspaces 2>&1 | grep '🏛️ command' | awk '{print $1}')
/Applications/cmux.app/Contents/Resources/bin/cmux send --workspace "$CMD_WS" "Captain report: {project} — task '{description}' DONE. Branch: {branch}. PR: {url}. Active crew: 0."
/Applications/cmux.app/Contents/Resources/bin/cmux send-key --workspace "$CMD_WS" Enter
```

**ALWAYS report to command** after:
- Task completed (success or failure)
- Blocker encountered that you can't resolve
- All assigned work is done (report idle)

**If you forget to close out, the dashboard will show stale data and command won't know you're done.**

## Group Awareness

If your config has `group` / `groupRole`:
- Read full config to find sibling projects with the same `group`
- If your change might affect a sibling, **flag it to command** so it can notify the sibling's captain
- Use **claude-mem** to search for context from sibling projects
- `primary` role: your changes may need propagation to forks/dependents

## Recording Learnings

Record after tasks complete, unexpected issues, or discovered patterns:
```bash
~/.config/cockpit/scripts/record-learning.sh "{spokeVaultPath}" "{category}" "{description}" "{tags}"
```
- Categories: `workflow`, `template`, `convention`, `bug`, `insight`
- Tags: comma-separated keywords for selective loading (e.g., `cairo,escrow,pvp`)

## Selective Loading (on session start)

Do NOT read all learnings. Instead, filter by relevance:
1. `grep -rl` your current task keywords in `{spokeVault}/learnings/` 
2. Also check for learnings tagged with your current branch name or feature area
3. Only read the matching files — skip the rest
4. For each learning you load, increment its `times_loaded` counter
5. If a learning actually helps your current work, run:
```bash
~/.config/cockpit/scripts/mark-learning-useful.sh "{learning-file-path}"
```

Learnings with `times_loaded > 5` and `times_useful: 0` are stale — ignore them.

## Capturing Skills (CAPTURED — from OpenSpace)

After a crew member completes a task that used a **novel or reusable pattern**, capture it as a skill:
```bash
~/.config/cockpit/scripts/capture-skill.sh "{spokeVaultPath}" "{skill-name}" "{one-line description}" "{full markdown body}"
```

**When to capture:**
- A task required a multi-step workflow that could apply to future tasks
- A crew member discovered a useful tool chain or command sequence
- A pattern emerged across 2+ similar tasks

**Don't capture** trivial one-off fixes or project-specific config.

Captured skills live in `{spokeVault}/skills/{name}/SKILL.md` and can be referenced by future crew members.

## Fixing Skills (FIX — from OpenSpace)

When a learning identifies that an existing skill's instructions are **wrong or outdated**:
```bash
~/.config/cockpit/scripts/fix-skill.sh "{spokeVaultPath}" "{skill-name}" "{corrected markdown body}"
```

This backs up the old version and writes the fix. Use when:
- A captured skill led to a failed task
- Instructions in a skill are now incorrect due to project changes
- A workaround in a skill is no longer needed

## Quality Tracking

Each learning and captured skill tracks:
- `times_loaded` — how often it was read into context
- `times_useful` — how often it actually helped (agent marks it)
- `times_used` / `times_successful` — for captured skills

Use these metrics to prune stale knowledge:
- Learning loaded 5+ times but never useful → skip it
- Skill used 3+ times but never successful → flag for FIX or removal
