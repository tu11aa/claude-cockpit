---
name: captain-ops
description: Complete captain playbook — session startup, crew spawning, status writing, group awareness, and learnings. Use this skill at session start and reference it throughout.
---

# Captain Operations

## Session Startup

1. Read `~/.config/cockpit/config.json` — match your current working directory. Note your `spokeVault`, `group`, `groupRole`, and `maxCrew` (default: 5).
2. **Check for handoff from previous session:**
```bash
~/.config/cockpit/scripts/read-handoff.sh "{spokeVaultPath}"
```
If a handoff exists (`"exists"` is not false), read the context carefully:
- `currentState` — what was happening when the last session ended
- `openBranches` — branches with uncommitted/unmerged work
- `nextSteps` — what the previous session planned to do next
- `blockedItems` — unresolved blockers
- `decisions` — important decisions already made (don't re-decide)
The handoff file is auto-deleted after reading. Use this as your primary context source.
3. Search **claude-mem** (`mem-search` skill) for your project name to get additional continuity.
4. Check `{spokeVault}/daily-logs/` — read the most recent log if one exists.
5. Check `{spokeVault}/learnings/` — **selectively** load relevant learnings (see "Selective Loading" section below). Do NOT read all files — grep by task keywords and tags.
6. Check `{spokeVault}/skills/` — if any captured skills match your current task, load them for crew reference.
7. Write active status:
```bash
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "captain_session" "active" "Captain session started"
```

## Setting Up Your Team

On session start (or when you receive your first task), create an Agent Team:
```
TeamCreate(team_name: "{project}-crew", description: "Crew for {project}")
```

This gives you persistent crew members, shared task lists, and mid-task messaging.

## Task Decomposition with Task Master

When you receive a **PRD, large feature request, or multi-step scope** from command, use **Task Master MCP** to decompose it before spawning crew.

### If a PRD file exists in the project:
```
mcp__task-master-ai__parse_prd(input: ".taskmaster/docs/prd.txt", projectRoot: "{projectPath}")
```
This generates `tasks.json` with structured tasks, dependencies, and complexity scores.

### Query tasks:
```
mcp__task-master-ai__get_tasks(projectRoot: "{projectPath}")           # List all tasks
mcp__task-master-ai__next_task(projectRoot: "{projectPath}")           # Get highest-priority unblocked task
mcp__task-master-ai__get_task(id: "1", projectRoot: "{projectPath}")   # Get specific task details
```

### Update task status as crew works:
```
mcp__task-master-ai__set_task_status(id: "1", status: "in-progress", projectRoot: "{projectPath}")
mcp__task-master-ai__set_task_status(id: "1", status: "done", projectRoot: "{projectPath}")
```

### Expand complex tasks into subtasks:
```
mcp__task-master-ai__expand_task(id: "1", projectRoot: "{projectPath}")
```

### Workflow:
1. Receive scope from command → **parse PRD** (or manually create tasks if no PRD file)
2. **get_tasks** to see the full dependency graph
3. **next_task** to find what's unblocked and highest priority
4. Spawn crew for that task
5. When crew finishes → **set_task_status** to "done" → **next_task** for the next one
6. Repeat until all tasks are done

**Note:** Task Master requires an AI provider API key (ANTHROPIC_API_KEY) for `parse_prd` and `expand_task`. If unavailable, create tasks manually using the project's task breakdown file (e.g., `pact-network-tasks.md`) and use Task Master only for status tracking.

## Spawning Crew

**You MUST spawn a crew member for ANY coding task** — even a one-line change. You are a coordinator. You plan, delegate, review, and merge. You do NOT write code yourself.

Use the **Agent tool** with `team_name`, `isolation: "worktree"`, and the appropriate `model`:
```
Agent(
  team_name: "{project}-crew",
  name: "🔧 {project}-crew-{task}",
  isolation: "worktree",
  model: "sonnet",
  prompt: "You are a crew member on {project}. Your task: {description}. Branch from: {branch}. Files involved: {files}."
)
```

For **review tasks**, use Opus for higher quality:
```
Agent(
  team_name: "{project}-crew",
  name: "🔍 {project}-review-{task}",
  model: "opus",
  prompt: "Review the changes on branch {branch}. Check for: correctness, edge cases, test coverage, style."
)
```

For **exploration/research**, use Haiku for cost efficiency:
```
Agent(
  name: "explore-{topic}",
  model: "haiku",
  prompt: "Quickly find: {question}. Return a concise answer."
)
```

- Do **NOT** manually run `git worktree add`
- Do **NOT** edit source code yourself — always delegate to crew
- Respect `maxCrew` limit
- **Model routing**: `sonnet` for coding, `opus` for reviews, `haiku` for exploration
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

## Session Shutdown — Write Handoff

**When the user says "wrap up", "end of day", or "shutdown", OR when you have no more tasks:**

1. First, write the daily log (use `cockpit:daily-log` skill).
2. Then, write a handoff file so tomorrow's session can resume instantly:

```bash
~/.config/cockpit/scripts/write-handoff.sh "{spokeVaultPath}" '{
  "currentState": "Brief description of where things stand",
  "openBranches": ["feat/branch-name — what it contains"],
  "nextSteps": ["First thing to do tomorrow", "Second thing"],
  "blockedItems": ["Any unresolved blockers"],
  "decisions": ["Key decisions made this session that should not be revisited"],
  "activeTasks": "Summary of task progress (e.g., 3/7 done)"
}'
```

3. Update status to inactive:
```bash
~/.config/cockpit/scripts/write-status.sh "{spokeVaultPath}" "captain_session" "inactive" "Session ended — handoff written"
```

4. Report to command that you're going offline.

**The handoff is your gift to tomorrow's session.** Be specific. "Working on the API" is useless. "Backend routes for /providers and /providers/:id are done, /timeseries endpoint is next, PR #12 is open for review" is useful.

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
