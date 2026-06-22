# Telegram Integration v1 — Design

- **Date:** 2026-06-22
- **Status:** Approved (brainstorm complete)
- **Supersedes:** `docs/specs/2026-06-15-telegram-integration-design.md`, `docs/plans/2026-06-15-telegram-integration.md`, PR #316 (`crew/telegram`)
- **Tracks / defers to:** #321 (hardening fast-follows), #309 (inline approve/deny buttons), per-crew topic routing (new follow-up)
- **Originating ask:** #65 (CLOSED) — drive squadrant from Telegram: receive push notifications and reply to steer a session from a phone.

## Why this supersedes PR #316

PR #316 was a complete, reviewed implementation, but it was built against an architecture that no longer exists:

1. **Flat `src/` layout.** #316 lives in `src/control/telegram/…`, `src/control/cockpitd.ts`, `src/config.ts`. The repo is now a six-package monorepo (`packages/{shared,core,agents,workspaces,web,cli}`). Every file placement is wrong.
2. **Mailbox relay deleted (#332).** #316's inbound path routes replies through "the existing mailbox relay" via a `captain.message` kind that `deliverable()` handled in a *separate relay process*. The relay was deleted and replaced by **daemon-direct cmux delivery** (`CaptainDelivery` + the in-daemon delivery loop). The transport at the heart of #316's inbound design is gone.
3. **Brand.** `cockpit telegram …` → `squadrant telegram …`; config keys rebranded.

The *ideas* in #316 survive (compose outbound onto the notify fan-out; inbound becomes a captain message; forum topics as the routing key; no third-party SDK). The *wiring* is rebuilt on the current architecture. The pure modules (HTTP client, formatters, state) are largely salvageable.

## Goals (v1)

- **Outbound:** crew lifecycle events (done / blocked / idle) and other captain notifications for a project are pushed to that project's Telegram topic.
- **Inbound (captain-only):** a message you send in a project's topic is delivered to that project's **captain pane** as a captain message. The captain decides what to do with it.
- **Opt-in & crash-contained:** zero behavior change when `telegram` config is absent; no Telegram failure can throw into the daemon event loop, mailbox, state machine, or watchdog.
- **Agent-agnostic:** this is captain/crew lifecycle plumbing, independent of which agent (claude/codex/opencode/gemini) a crew runs.

## Non-goals (explicitly deferred)

- **Per-crew topic routing / replying directly to a specific crew task.** v1 routes inbound to the captain only. The design reserves the extension point (see Routing key) so this is additive later.
- **#321 hardening:** `link` ↔ daemon `getUpdates` 409 race, user-id allowlist, honoring 429 `retry_after`, pruning terminal topics from the registry, at-least-once inbound documentation.
- **#309:** inline approve/deny keyboards for BLOCKED events (`reply_markup` + `callback_query`). Mine OpenACP (streaming) and CliGate (Approve/Deny inline) as UX references when picked up.

## Architecture

A **daemon-internal subsystem**, `TelegramBridge`, modeled on the existing `CmuxEventsBridge` — started/stopped inside the daemon, **not** a separate relay process. It owns one outbound hook and one inbound long-poll loop.

```
                         ┌─────────────────── squadrant daemon ───────────────────┐
crew lifecycle event ───▶│ ctx.notify(...) ──▶ mailbox ──▶ delivery loop ──▶ cmux ─┼─▶ captain pane
                         │        └────────────▶ TelegramBridge.pushLifecycle() ───┼─▶ Telegram topic (outbound)
                         │                                                          │
 Telegram topic msg ─────┼─▶ TelegramBridge.getUpdates loop ─▶ allowlist check ────┤
   (inbound reply)       │       └─▶ append captain.message mailbox entry ─▶ delivery loop ─▶ cmux ─▶ captain pane
                         └──────────────────────────────────────────────────────────┘
```

**Decision (approved): inbound reaches the captain via a new mailbox kind, not a direct surface write.** There is no inbound→captain path today. Two options were considered:

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | inbound msg → new `captain.message` mailbox entry → existing delivery loop → captain pane | Reuses `CaptainDelivery`: defer-while-the-captain-is-typing (#302), ordered delivery, cursor-ack. Minimal new delivery code. |
| B | bridge writes directly to the captain cmux surface | Bypasses mailbox; loses defer protection; can clobber the captain's draft. |

Approach A is chosen because the #332 delivery loop already solves ordered, non-clobbering delivery to the captain — the exact problem an inbound message has.

## Components

| Module | Package | Purpose |
|---|---|---|
| `telegram/client.ts` | `core` | Bot API over plain `fetch` (no runtime SDK). Methods: `getUpdates`, `sendMessage`, `createForumTopic`. Injectable `fetch` for tests. |
| `telegram/format.ts` | `core` | Pure formatters: topic name for a project, outbound lifecycle text, inbound→captain message text. No I/O. |
| `telegram/state.ts` | `core` | Persisted JSON in `stateRoot`: `getUpdates` offset + `{ project → topicId }` registry. |
| `telegram/bridge.ts` | `core` | The subsystem. `start()/stop()`, `pushLifecycle(project, event)` (outbound), and the `getUpdates` long-poll (inbound). Crash-contained. |
| `TelegramConfig` | `shared` | Optional `telegram?` field on `SquadrantConfig` (see Config). |
| `captain.message` mailbox kind | `core` | New `MailboxEntry` kind for inbound external messages; rendered to the captain by the delivery loop. |
| `telegram` command | `cli` | `squadrant telegram link <project>` (bind a project to a topic) and `squadrant telegram status` (config + bridge liveness). |
| bridge wiring | `cli` (`squadrantd.ts`) + `core` (`daemon/start.ts`) | Instantiate alongside `CmuxEventsBridge`/`OpencodeSseBridge`; start in boot, stop in shutdown. |

**Dependency note:** runtime stays SDK-free (plain `fetch`). Add **`@grammyjs/types`** as a **devDependency only** — types for `Update`/`Message`/`CallbackQuery`, zero runtime/bundle weight (preserves the tsup single-binary constraint). Research (`side-handoffs/telegram-reuse-vs-build.md`) confirmed no existing project is embeddable as a transport, and full bot frameworks (grammY/telegraf/node-telegram-bot-api) are over-built or EOL for a ~5-endpoint bridge that must share the daemon's own loop.

## Data flow

### Outbound (crew → you)
1. Daemon fires a captain notification for project X (existing `ctx.notify(...)`).
2. The bridge's outbound hook *also* calls `client.sendMessage(topicId(X), formatLifecycle(event))`, **best-effort**.
3. A failed/slow Telegram send is swallowed (logged) and **never blocks or delays** cmux delivery to the captain pane.

### Inbound (you → captain)
1. Bridge `getUpdates` long-poll receives a message with `(chat_id, message_thread_id)`.
2. **Allowlist check** on `chat_id` against `config.telegram.chats`; non-allowlisted messages are dropped.
3. Resolve `message_thread_id → project` via the topic registry.
4. Append a `captain.message` mailbox entry for that project with the message text.
5. The existing delivery loop hands it to the project's captain pane, defer-protected.
6. Inbound text is **data, never a shell command** — it becomes a captain message; the captain interprets it.

## Routing key (extensibility for per-crew, deferred)

The registry maps a **`(project, scope)`** pair to a Telegram topic. v1 only ever uses `scope = "project"`. Adding per-crew topics later means emitting `scope = "crew:<taskId>"` entries and routing those inbound messages to the daemon's `handle({ kind: "reply", project, id, message })` path — additive, no schema change to v1's state file.

## Config

Add an optional field to `SquadrantConfig` (`packages/shared/src/config.ts`):

```jsonc
"telegram": {
  "botToken": "…",          // or read from env TELEGRAM_BOT_TOKEN
  "supergroupId": -1001234,  // the forum supergroup hosting per-project topics
  "chats": [-1001234],       // chat_id allowlist (inbound honored only from these)
  "pollMs": 1000             // optional getUpdates long-poll cadence
}
```

Absent `telegram` ⇒ the bridge is never constructed; no behavior change. Read in `startSquadrantd` before constructing the bridge.

## Security (v1)

- **`chat_id` allowlist** — only messages from configured chats are honored.
- **Text is data, not commands** — inbound becomes a captain message; never executed.
- **Documented gap:** chat membership ⇒ captain control (anyone in the linked supergroup can steer). The user-id allowlist that closes this is deferred to #321 and called out in the setup docs.

## Error handling

- The bridge is **crash-contained**: outbound send and inbound poll are wrapped so a throw/reject cannot escape into the daemon. Failures are logged and the loop continues.
- **Offset persistence** survives daemon restarts so inbound is at-least-once, not lost (exactly-once is not guaranteed; documented).
- v1 uses a flat backoff on poll errors; honoring 429 `retry_after` is deferred to #321.

## Testing

- **Unit:** `format` (pure in/out), `state` (offset + registry persistence round-trip), `client` (injected `fetch` asserts URL/method/payload), bridge **crash-containment** (a throwing `sendMessage`/`getUpdates` cannot escape `start()`).
- **Integration:** inbound message → a `captain.message` mailbox entry appears for the correct project; outbound composes onto `notify` without blocking the captain delivery path.
- **Gates:** `squadrant telegram status` with no token prints "unset" and does not crash; the ESM gate `node dist/index.js --help` passes; full `pnpm test` green against the known baseline.

## Salvage from PR #316

- **Reusable (port + rebrand):** `client.ts`, `format.ts`, `state.ts` — pure/HTTP, no relay coupling.
- **Rewrite:** `subsystem.ts` → `bridge.ts` (new daemon-internal lifecycle, Approach A inbound), config wiring (now `packages/shared`), command (now `packages/cli`, rebranded), mailbox change (new `captain.message` kind on the current mailbox, not the deleted relay).

## Rollout

1. Land v1 behind opt-in config (this spec).
2. Harden via #321.
3. Add inline approve/deny buttons via #309.
4. Add per-crew topic routing (new follow-up) using the reserved `(project, scope)` key.
