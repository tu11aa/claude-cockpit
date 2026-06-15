# cmux native event stream — investigation (audit item B1)

**Date:** 2026-06-16 · **Branch:** `feat/cmux-events-stream` · **cmux:** 0.64.16 (96)

Goal: reduce cockpit's fragile screen-scraping by consuming cmux's native event
stream. **Additive & safe** — the events consumer runs alongside the existing
relay-proxy / pane-reader path, which stays as the fallback during migration.

## STEP 0 — does `cmux events` exist? YES.

`cmux events` streams **newline-delimited JSON** over the cmux Unix socket.

```
cmux events [--after <seq>] [--cursor-file <path>] [--name <event>]
            [--category <category>] [--reconnect] [--limit <n>]
            [--no-ack] [--no-heartbeat]
```

- `--reconnect` — reconnect forever, resume from last received seq (in-process).
- `--cursor-file <path>` — read the starting seq from a file, update it after
  each event. **Durable resume across daemon restarts.**
- `--after <seq>` — replay retained events after a sequence.
- `--category` / `--name` — server-side filters, repeatable.
- `--no-heartbeat` — suppress the 15s heartbeat frames.

### Frame shapes (live-captured)

**Ack** (first frame; suppress with `--no-ack`):
```json
{"type":"ack","protocol":"cmux-events","version":1,"boot_id":"…",
 "subscription_id":"…","heartbeat_interval_seconds":15,"replay_count":0,
 "resume":{"after_seq":null,"gap":false,"latest_seq":1434,"next_seq":1435,
           "oldest_seq":1,"requested_after_seq":1434},
 "filters":{"categories":[],"names":[]}}
```
`resume.gap:true` signals retained-buffer overflow (events were dropped).

**Event**:
```json
{"type":"event","protocol":"cmux-events","version":1,"seq":1435,
 "boot_id":"…","id":"…-1435","category":"agent",
 "name":"agent.hook.PreToolUse","occurred_at":"2026-06-15T17:02:17.362Z",
 "source":"claude","workspace_id":"2AED…","surface_id":null,"pane_id":null,
 "window_id":null,
 "payload":{ "_source":"claude","session_id":"claude-7ba3…","_ppid":70993,
   "cwd":"/Users/q3labsadmin/me/claude-cockpit",
   "hook_event_name":"PreToolUse","phase":"received|completed",
   "tool_name":"Bash","workspace_id":"2AED…", … }}
```

### Categories / names observed live

| category       | names                                                                  |
|----------------|------------------------------------------------------------------------|
| `agent`        | `agent.hook.PreToolUse`, `agent.hook.Stop`, `agent.hook.SubagentStop`  |
| `feed`         | `feed.item.received`, `feed.item.completed`                             |
| `notification` | `notification.created/requested/cleared/clear_requested`               |
| `sidebar`      | `sidebar.metadata.updated`                                              |

The `agent` category is what we want: it mirrors Claude Code hook events
(`PreToolUse`, `Stop`, `SubagentStop`, etc.) with `payload.cwd`,
`payload.session_id`, `payload._source` (agent kind), and `workspace_id`.

## Key architectural difference vs the opencode SSE bridge

`OpencodeSseBridge` subscribes **per-crew** to that crew's `opencode --port N`
HTTP server. `cmux events` is a **single global stream** for the whole cmux app,
carrying every agent's hook events. So the cmux bridge is **one** long-lived
subscription owned by the daemon, and each frame is **correlated** to a crew
TaskRecord rather than arriving pre-addressed.

### Correlation key: `payload.cwd` → `TaskRecord.cwd`

Interactive crews run in an **isolated worktree** whose path becomes the record's
`cwd` (`crew.ts` sets `cwd: spawnCwd`). Each worktree path is unique, so
`payload.cwd === rec.cwd` cleanly maps a hook event to its crew. We only consider
**non-terminal interactive** records, matching `_source` to the record provider.

Limitation (prototype): a `--shared` crew runs with `cwd === projRoot`, which
collides with the captain's cwd — those fall back to the existing scrape path.
This is acceptable: scrape remains the fallback by design.

## Mapping (minimal, idempotent)

| cmux event                         | ControlEvent emitted      | effect                         |
|------------------------------------|---------------------------|--------------------------------|
| `agent.hook.Stop` (main session)   | `task.turn.completed`     | working → awaiting-input       |
| `agent.hook.SubagentStop`          | *(ignored)*               | subagent end ≠ turn end        |

`Stop` is the high-value signal: it's exactly the "turn ended / crew idle" state
the pane-reader currently infers by scraping the screen. `task.turn.completed` is
**liveness, not completion** (anti-#2576): terminal state still comes from the
explicit `cockpit crew signal done`. The state-machine reducer already absorbs
duplicate/late `task.turn.completed`, so feeding it from BOTH the events bridge
and the existing path is harmless — the core property that makes this additive.

## Lifecycle

- Started once in the daemon boot IIFE (next to opencode re-subscribe).
- Durable resume via `--cursor-file <stateRoot>/cmux-events.seq` + `--reconnect`.
- Stopped in the daemon's returned `stop()` (kill the child).
- Gated behind `defaults.cmuxEventsBridge` (default **on**); set false to fall
  back to scrape-only.

## Conclusion

`cmux events` exists, is stable JSON, exposes the agent hook surface we need, and
resumes durably. Safe to prototype a consumer alongside the scrape fallback.
