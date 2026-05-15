# Telegram Remote Control — Design

- **Date:** 2026-05-15
- **Status:** Approved (design); implementation blocked by #64
- **Issues:** #65 (Phase 1), #66 (Phase 2), **blocked by #64** (reliability cluster: #18, #19, #64)

## Motivation

Core scenario: the user is away from the desk (e.g. at a meal). A boss DMs about a
situation on a project. The user needs to, from their phone: send an instruction to
that project; if the project's captain is not running, have the system stand itself
up (spawn the captain), which then spawns crew as normal; and get progress / blocked
/ done notifications back so they can steer with a reply. In short: **act as Command
from the phone**, at parity with sitting at the desk.

## Feasibility verdict

Feasible and well-matched. The Telegram Bot API uses **long-poll** (`getUpdates`) —
the machine polls Telegram outbound, so there is **no inbound server, no port
forwarding, no public IP**. It works from a laptop behind NAT/firewall, which is the
target environment. Telegram also provides a polished mobile client for free
(nothing to build or distribute). The cockpit primitives needed already exist:

- Inbound: `cockpit runtime send <project> "msg"` / `cockpit crew send` →
  cmux `send` + `send-key Enter` into the live pane (`src/runtimes/cmux.ts`).
- Outbound: `cockpit runtime read-screen` / `crew read` → session snapshot.
- Event detection: the reactor cycle classifies every captain idle/busy/blocked/
  errored and writes `status.md` (`src/reactor/auto-status.ts`).
- Notifier slot: `NotifierDriver` (`src/notifiers/types.ts`) is the existing,
  purpose-built seam for "message the human".

## Hard dependency: #64 (reliability cluster)

The push path is: reactor reads the **captain** pane each cycle → classifies a
transition → fires `notify()` → phone. This only works if the captain pane reflects
reality. Today two failures break that:

- Crew finishes but never reports to the captain.
- Captain does not reliably poll crew panes, so it never notices done/blocked.

Result: completion is silent, the reactor never sees a transition, **no push fires
and the user misses it**. This is tracked as **#64** (with siblings **#18**
command→captain send-submit, **#19** captain→command post-compact drift). #64 must
land before Phase 1 implementation starts. It is a prerequisite, not an enhancement.

## Approach (chosen: A)

**A — dedicated Telegram module + notifier-slot push, no refactor of existing code.**
Recommended and approved. Smallest new surface; reuses every existing primitive;
notifier slot already exists for exactly this; reactor already detects the events.

Rejected alternatives:

- **B — generalize the reactor into a multi-source event bus.** Architecturally
  tidy, likely where Phase 2 trends, but a large refactor of a working subsystem
  for zero Phase-1 benefit. Deferred to Phase 2 (#66).
- **C — notifier-only (push, no reply).** Smallest, but fails the explicit
  Phase-1 requirement (reply + create issues). Under-delivers.

## Architecture

```
src/telegram/
  client.ts     # raw fetch wrapper: getUpdates (long-poll), sendMessage,
                #   answerCallbackQuery — no SDK dependency
  serve.ts      # forever loop: getUpdates(offset) -> router; backoff on failure;
                #   persists offset across restarts
  router.ts     # parse a Telegram update -> a cockpit action
  threadmap.ts  # ~/.config/cockpit/telegram-threads.json:
                #   message_id -> {project}, plus the update offset
src/notifiers/telegram.ts   # NotifierDriver.notify() -> push; stamps threadmap
src/commands/telegram.ts    # `cockpit telegram serve | status | test`,
                            #   registered in src/index.ts
```

The poller (`cockpit telegram serve`) runs as a background task in the always-on
**Reactor workspace**, next to the reactor cycle — one home for both pollers, off
the dev machine's foreground.

## Command surface (Phase 1)

| Input | Behaviour |
|---|---|
| `/send <project> <instruction…>` | Resolve captain. **Running** → `runtime send`. **Cold** → auto `cockpit launch <project>`, poll `runtime status` until ready (~60s timeout), then `runtime send`. Ack: "spawned captain for X, sent your instruction." |
| native **reply** to a push | Look up `message_id → {project}` in threadmap → behaves as `/send <that project> <reply body>`. Zero typing of names — the primary lunch path. |
| `/status` | Summarise every project from the `status.md` files the reactor already writes. |
| `/issue <project> <title…>` | `gh issue create` in that project's repo. |
| `/projects`, `/help` | List configured projects / usage. |
| non-allowlisted chat | Silently ignored + logged. |

The user always talks to the **captain** (the Command→Captain seam). The captain
owns crew spawning, exactly as today.

## Cold-start behaviour

**Auto-spawn, then notify** (chosen). On no captain: the bot runs
`cockpit launch <project>` itself, polls `cockpit runtime status <project>` until
ready (≤ ~60s), delivers the instruction, and confirms ("spawned captain for X,
sent your instruction"). Zero round-trips while the user is away. On timeout, the
instruction text is pushed back so it is never lost.

## Data flow (the lunch scenario)

1. Boss DMs the user about a situation on `oneplan`.
2. User: `/send oneplan investigate 500s on checkout, hotfix if found`.
3. Router sees `oneplan` cold → `cockpit launch oneplan` → poll until captain ready.
4. `runtime send oneplan "<instruction>"` → ack to phone.
5. Captain plans, spawns crew, executes (normal flow).
6. Reactor cycle classifies state each tick. On a transition into a `pushEvents`
   state, the existing classify→`notify()` path fires the `telegram` notifier →
   push to phone, message stamped `message_id → oneplan`.
7. User replies to the push → router maps reply → `oneplan` → `runtime send` →
   loop. Parity with sitting at the desk as Command.

## Security (deny-by-default, baked in)

- **Allowlist is the hard gate**: the bot acts only on
  `config.telegram.allowedChatIds`. A leaked bot token alone cannot drive the
  machine.
- Phase-1 surface is **bounded**: `/send` into a captain, `/issue`, `/status`.
  **No arbitrary shell.**
- Bot token via `COCKPIT_TELEGRAM_TOKEN` env (preferred), with
  `config.telegram.botToken` fallback — keeps the secret out of the repo.
- Phase 2's full remote driving is explicitly **out of scope here** and gated
  behind its own opt-in flag and a separate security review (#66).

## Config addition (`~/.config/cockpit/config.json`)

```json
"telegram": {
  "allowedChatIds": [123456789],
  "pushEvents": ["blocked", "errored", "done"]
}
```

Token from env. `pushEvents` selects which reactor state-transitions push.

## Error handling

- `getUpdates` failure → exponential backoff; the loop never dies.
- Bad bot token → loud failure at `serve` start (probe), not silent.
- `/send` to an unknown project → reply with the `/projects` list.
- Cold-start timeout → push the instruction text back so it is never lost.
- Telegram API 429 → honour `retry_after`.
- Restart → persisted update offset prevents replay of old messages.

## Testing

- **Unit**: router parsing per command + reply mapping; threadmap prune; allowlist
  enforcement; cold-start decision (mocked `runtime status`).
- **Integration**: a fake Telegram client (in-memory update queue + captured
  `sendMessage`) plus a fake `RuntimeDriver` → assert a cold project triggers
  `launch` then `send`; assert a non-allowlisted chat is ignored.
- **Manual**: real bot + real phone, full lunch scenario end-to-end.

## Explicitly NOT building (YAGNI)

No webhook / inbound HTTP server (long-poll only) · no multi-user / RBAC
(single-user allowlist) · no reactor event-bus refactor (Phase 2 / Approach B) ·
no arbitrary command execution (Phase 2) · text only — no media / dashboards.

## Phasing

- **Phase 1 (#65, this spec):** `telegram serve`, `/send` with auto cold-start,
  `/status`, `/issue`, native reply routing, `telegram` notifier wired into the
  reactor push path, allowlist security, runs in the Reactor workspace.
  *Blocked by #64.*
- **Phase 2 (#66, documented extension point, not built):** full remote driving —
  arbitrary cockpit lifecycle (direct crew spawn/close, launch/shutdown,
  whitelisted `cockpit` subcommands) behind an explicit opt-in flag plus its own
  threat-model review; revisit Approach B (event-bus) once the interaction model
  is proven.
