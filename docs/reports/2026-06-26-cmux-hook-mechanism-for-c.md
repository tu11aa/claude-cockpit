# cmux hook mechanism — implementation blueprint for NativeHookSource (C)

**Date:** 2026-06-26  
**Issue:** [#333](https://github.com/tu11aa/squadrant/issues/333)  
**Purpose:** Read-only investigation of `~/.cmuxterm/` to give Phase 3's `NativeHookSource` a concrete spec to mimic cmux's proven approach.  
**Scope:** `claude` agent only (the only agent with cmux hooks installed on this machine).

---

## 1. Files cmux writes

Three files under `~/.cmuxterm/` (override via `CMUX_AGENT_HOOK_STATE_DIR`):

| File | Written by | Format | Consumers |
|---|---|---|---|
| `claude-hook-sessions.json` | Every lifecycle-changing hook event | JSON (structured, version:1 implied) | `CmuxStoreSource`, daemon |
| `events.jsonl` | Every cmux event (hooks, UI, notifications) | NDJSON, rotates to `events.jsonl.1` | `CmuxEventsBridge` cursor stream |
| `workstream.jsonl` | Workstream-level events (session/tool/prompt) | NDJSON | Lower-level transcript, not lifecycle |

---

## 2. `claude-hook-sessions.json` — the primary surface for `CmuxStoreSource`

### 2.1 Schema (live, captured 2026-06-26)

```jsonc
{
  "sessions": {
    "<sessionId-uuid>": {
      // ── Lifecycle (the field CmuxStoreSource reads) ──
      "agentLifecycle": "running" | "idle" | "needsInput" | "unknown",

      // ── Identity ──
      "sessionId": "<uuid>",          // cmux session UUID = claude session UUID (no prefix)
      "surfaceId": "<UUID>",          // cmux terminal pane UUID

      // ── Correlation ──
      "pid": 89927,                   // OS pid of the agent process (always present)
      "cwd": "/path/to/worktree",     // working directory at launch

      // ── Human-readable lifecycle detail ──
      "lastBody": "Claude needs your permission",
      "lastSubtitle": "Permission",

      // ── Timestamps (Unix float, not ISO) ──
      "startedAt": 1782467161.876,
      "updatedAt": 1782467498.596,    // updated on every hook write

      // ── Hibernation ──
      "isRestorable": true,           // present on all observed sessions; true when hibernatable

      // ── Launch info ──
      "launchCommand": {
        "arguments": ["/path/to/claude", "--model", "sonnet", ...],
        "capturedAt": 1782467161.873,
        "executablePath": "/path/to/claude",
        "launcher": "claude",
        "source": "environment",
        "workingDirectory": "/path/to/worktree"
      },

      // ── Other fields ──
      "workspaceId": "<UUID>",
      "transcriptPath": "/path/to/.claude/projects/.../{sessionId}.jsonl"
    }
  },
  "activeSessionsBySurface": {
    "<surfaceId>": {
      "sessionId": "<uuid>",
      "updatedAt": 1782453917.15,
      "allowsNewSessionReplacement": true   // optional
    }
  }
}
```

**28 sessions** observed on this machine; all have `pid`, `launchCommand`, `isRestorable`.

### 2.2 Critical finding: `launchCommand` does NOT contain environment variables

`launchCommand` fields are: `arguments`, `capturedAt`, `executablePath`, `launcher`, `source`, `workingDirectory`. There is no `environment` key-value dict. `source: "environment"` means the session was launched from the terminal environment, not a captured env-var map.

**Implication for `CmuxStoreSource`:** `SQUADRANT_CREW_TASK_ID` is NOT directly available in the store file. Correlation must use:
1. **`pid`** → read process environment via macOS `proc_pidinfo` / `KERN_PROCARGS2` to extract `SQUADRANT_CREW_TASK_ID` — this is the cleanest path.
2. **`cwd`** fallback → match against `TaskRecord.cwd`; collision-prone when worktrees are shared (see #333 §2.4 warning).
3. **`sessionId`** → the store's `sessionId` is the claude session UUID (same as the JSONL transcript filename, without the `claude-` prefix used in events.jsonl).

### 2.3 `agentLifecycle` value set

All four `LifecycleState` values are observed in the wild: `running`, `idle`, `needsInput`, `unknown`.

---

## 3. Hook events → `agentLifecycle` transitions

cmux updates `agentLifecycle` in the store on every hook event. The mapping (derived from `events.jsonl` and cross-referenced with the spec):

| `agent.hook.*` event | `agentLifecycle` after | Notes |
|---|---|---|
| `SessionStart` | `running` | Session just started |
| `UserPromptSubmit` | `running` | User submitted a prompt; turn is live |
| `PreToolUse` | `running` | A tool call is in flight |
| `Stop` | `idle` | Turn ended; crew alive and quiescent |
| `SubagentStop` | _(no change)_ | Subagent end ≠ turn end; cmux ignores this for lifecycle |
| `Notification` | `needsInput` | Agent surfaced a notification (e.g. CREW BLOCKED) |
| `AskUserQuestion` | `needsInput` | Agent asking a human question |
| `SessionEnd` | _(teardown)_ | Session gone; cmux may remove or mark record |

**Frequency from `events.jsonl` (this machine, all time):**
```
4307  agent.hook.PreToolUse       ← dominant (every tool call)
 664  agent.hook.Stop             ← turn-end signal
 394  agent.hook.UserPromptSubmit
 264  agent.hook.Notification
 242  agent.hook.SubagentStop     ← not lifecycle-changing
 120  agent.hook.SessionStart
  86  agent.hook.SessionEnd
  44  agent.hook.AskUserQuestion
```

---

## 4. `events.jsonl` — the streaming wire (currently used by `CmuxEventsBridge`)

### 4.1 Schema (one NDJSON object per line)

```jsonc
{
  "boot_id": "<UUID>",
  "category": "agent",              // or "feed", "notification", "sidebar", "surface", …
  "id": "<boot_id>-<seq>",
  "name": "agent.hook.PreToolUse",  // the event name
  "occurred_at": "2026-06-25T09:20:18.756Z",
  "pane_id": null,
  "payload": {
    "hook_event_name": "PreToolUse",
    "phase": "received" | "completed",  // cmux processes hooks in two phases
    "session_id": "claude-<uuid>",       // NOTE: has "claude-" prefix; strip for store lookup
    "cwd": "/path/to/worktree",
    "_source": "claude",
    "_ppid": 67114,
    "tool_name": "Bash",               // only on PreToolUse/PostToolUse
    "context_length": 1236,
    "redacted_fields": ["tool_input", "context"]
  },
  "protocol": "cmux-events",
  "seq": 8775,
  "source": "claude",
  "surface_id": null,
  "type": "event",
  "version": 1,
  "window_id": null,
  "workspace_id": "<UUID>"
}
```

**Key details:**
- Each hook fires **two events**: `phase: "received"` then `phase: "completed"`. The existing `CmuxEventsBridge` acts on `phase: "completed"` only.
- `payload.session_id` uses the `claude-<uuid>` format; the store's `sessionId` is the bare UUID.
- The file rotates (`events.jsonl` → `events.jsonl.1`). `cmux events --cursor-file` handles rotation automatically.

### 4.2 How `CmuxEventsBridge` consumes it

`CmuxEventsBridge` runs a long-lived `cmux events --cursor-file <path>` child process, reading NDJSON frames and mapping `agent.hook.*` names to `RunState` via `deriveRunState()` (see `packages/workspaces/src/cmux-daemon/events-bridge.ts`). It resolves the crew by `payload.cwd`.

**`NativeHookSource` does NOT need `events.jsonl`.** The store file is the right surface — `events.jsonl` is an internal wire that requires the `cmux events` process; the store is a stable, directly-readable external surface.

---

## 5. `workstream.jsonl` — transcript-level log (not for lifecycle)

Lower-level per-turn content log. `kind` values: `toolUse` (18k+), `stop`, `userPrompt`, `toolResult`, `sessionStart`, `sessionEnd`, `question`. Fields: `workstreamId`, `payload`, `updatedAt`, `id`, `source`, `kind`, `cwd`, `ppid`.

**`NativeHookSource` does NOT need `workstream.jsonl`** — it's a turn-content log, not a lifecycle signal.

---

## 6. Write triggers and timing

cmux updates `claude-hook-sessions.json` **synchronously on each hook event** that changes lifecycle state. The `updatedAt` field advances with each write. The file is written as a whole (full JSON overwrite, not append), so consumers must:

1. `fs.watch` the directory (debounced ~50ms for write bursts).
2. Re-read and re-parse the full JSON on each change notification.
3. Iterate sessions and compare `updatedAt` against a cached value to detect changes.

The lock file `claude-hook-sessions.json.lock` is used by cmux during writes — consumers should retry or check the lock before reading to avoid torn reads.

---

## 7. `isRestorable` and the hibernation invariant

All 27/28 sessions with `launchCommand` also have `isRestorable: true`. When cmux hibernates a session (RAM reclaim), the OS process may be suspended or gone, but the session is logically alive and resumable.

**`CmuxStoreSource` MUST NOT emit `task.session.ended` for a session where `isRestorable: true` and `agentLifecycle: "idle"`.** A pid-verify failure on a restorable idle session means "hibernated", not "dead". Only pid-gone AND `isRestorable: false` (or field absent) should trigger `alive: false → task.session.ended`.

---

## 8. Correlation path for `CmuxStoreSource` — recommended implementation

```typescript
// Priority 1: pid → read KERN_PROCARGS2 / process env → SQUADRANT_CREW_TASK_ID
async function resolveTaskId(session: StoreSession): Promise<string | undefined> {
  const taskId = await readEnvFromPid(session.pid, "SQUADRANT_CREW_TASK_ID");
  if (taskId) return taskId;

  // Priority 2: cwd → match TaskRecord.cwd (collision-prone, use as fallback)
  const byPath = store.findNonTerminal(r => r.cwd === session.cwd);
  return byPath?.id;
}

// Priority 3: sessionId — strip "claude-" prefix if present and match TaskRecord.sessionId
//   session.sessionId (store UUID) === TaskRecord.sessionId (when crews populate it)
```

For macOS `readEnvFromPid`:
- Use `proc_pidinfo` with `PROC_PIDTASKALLINFO` or spawn `ps -E -p {pid}` as a fallback.
- A cleaner approach: open `/proc/{pid}/environ` on Linux or use `sysctl KERN_PROCARGS2` on macOS (the design spec §4 describes this path for `NativeHookSource`).

---

## 9. What `NativeHookSource` should mimic

`NativeHookSource` installs **squadrant-owned hooks** into each agent's native config, pointing at `squadrantd hooks <agent> <sub>`. Each hook invocation is fire-and-forget (`|| true`). The daemon receives it over the control socket and calls `report()` with `origin: "agent"`.

Mirroring cmux's `CMUXCLI+AgentHookDefinitions.swift` pattern:

| Hook event | `squadrantd hooks claude <sub>` | `LifecycleState` |
|---|---|---|
| `SessionStart` | `session-start` | `running` |
| `UserPromptSubmit` | `prompt-submit` | `running` |
| `PreToolUse` | `pre-tool-use` | `running` (+ tool name in detail) |
| `Stop` | `stop` | `idle` |
| `Notification` | `notification` | `needsInput` |
| `AskUserQuestion` | `ask-question` | `needsInput` |
| `SessionEnd` | `session-end` | _(teardown, emit `task.session.ended`)_ |

The hook payload must include `SQUADRANT_CREW_TASK_ID` (available as an env var inside the hook's execution context, since it's set on the crew's process). This is the **only** reliable collision-proof correlation key and eliminates the need for KERN_PROCARGS2 in NativeHookSource (unlike CmuxStoreSource, which reads an external file).

---

## 10. Summary for implementers

| Concern | CmuxStoreSource (Phase 1) | NativeHookSource (Phase 3) |
|---|---|---|
| Primary input | `~/.cmuxterm/claude-hook-sessions.json` | `squadrantd hooks <agent> <sub>` socket calls |
| Watch mechanism | `fs.watch` directory (debounced) + lock-aware JSON parse | Control socket (existing daemon infra) |
| Correlation key | `pid → KERN_PROCARGS2 → SQUADRANT_CREW_TASK_ID` + `cwd` fallback | `SQUADRANT_CREW_TASK_ID` in hook env (direct) |
| `origin` on snapshots | `"agent"` (store carries agent-reported lifecycle) | `"agent"` |
| Liveness floor | pid-verify (`process.kill(pid, 0)`) per session | KERN_PROCARGS2 process scan |
| `needsInput` source | `agentLifecycle: "needsInput"` in store | `Notification` / `AskUserQuestion` hook events |
| Hibernation guard | `isRestorable: true` → alive-idle (not dead) | Process suspended but taskId env survives |
| cmux coupling | Yes — file vanishes without cmux | None — hooks in agent's own config |
