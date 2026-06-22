# Telegram Integration v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every task — write the failing test first, then the minimal implementation. Steps use checkbox (`- [ ]`) syntax for tracking. This plan fixes the decomposition, file map, interfaces, and test criteria; you write the test + implementation bodies under TDD.

**Goal:** Two-way Telegram for squadrant — push per-project crew lifecycle events to a Telegram topic, and deliver your replies into that project's captain pane.

**Architecture:** A daemon-internal `TelegramBridge` (modeled on `CmuxEventsBridge`) with one outbound hook composed onto `ctx.notify(...)` and one `getUpdates` long-poll. Inbound becomes a new `captain.message` mailbox kind delivered by the existing #332 delivery loop (defer-protected). Opt-in via config; crash-contained.

**Tech Stack:** TypeScript (strict ESM, NodeNext), plain `fetch` for the Bot API (no runtime SDK), `@grammyjs/types` as a **devDependency** for typed payloads, tsup single-binary bundle, vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-telegram-integration-v1-design.md`

## Global Constraints

- **No runtime dependency** for Telegram — plain `fetch` only. `@grammyjs/types` is **devDependencies-only** (types erased at build; zero bundle weight). A runtime dep that doesn't tsup-bundle cleanly is a regression.
- **Strict ESM / NodeNext** — every relative import ends in `.js`. The real gate is `node dist/index.js --help`, not just `tsc`/vitest.
- **Opt-in** — absent `config.telegram` ⇒ the bridge is never constructed; zero behavior change. No new always-on work.
- **Crash-contained** — no Telegram send/poll error may escape into the daemon event loop, mailbox, state machine, or watchdog. Catch-log-continue.
- **Inbound is data, never a shell command** — it becomes a captain message only.
- **Brand:** CLI is `squadrant telegram …`; config under `~/.config/squadrant/config.json`.
- **Package DAG (one-way):** `shared ◄ core ◄ {agents,workspaces,web} ◄ cli`. Config types in `shared`; bridge/client/format/state/mailbox in `core`; command + daemon wiring in `cli`.
- **Routing key is `(project, scope)`** — v1 emits only `scope:"project"`; never hardcode project-only so per-crew (`scope:"crew:<taskId>"`) is additive later.

---

## File structure

| File | Package | Responsibility |
|---|---|---|
| `packages/shared/src/config.ts` (modify) | shared | Add `TelegramConfig` + `telegram?` on `SquadrantConfig` |
| `packages/core/src/telegram/format.ts` (create) | core | Pure formatters (topic name, lifecycle text, inbound text) |
| `packages/core/src/telegram/state.ts` (create) | core | Persisted offset + `(project,scope)→topicId` registry |
| `packages/core/src/telegram/client.ts` (create) | core | Bot API over injectable `fetch` |
| `packages/core/src/telegram/bridge.ts` (create) | core | The subsystem: start/stop, pushLifecycle, inbound loop |
| `packages/core/src/telegram/index.ts` (create) | core | Barrel export |
| `packages/core/src/mailbox.ts` (modify) | core | Add `captain.message` kind + `appendCaptainMessage` |
| `packages/cli/src/commands/telegram.ts` (create) | cli | `telegram link` / `telegram status` |
| `packages/cli/src/index.ts` (modify) | cli | Register `telegramCommand` |
| `packages/cli/src/control/squadrantd.ts` (modify) | cli | Construct bridge when configured; compose onto notify; start/stop |
| `packages/core/src/daemon/start.ts` (modify) | core | Start/stop hook for the bridge in boot/shutdown |
| `README.md` / `AGENTS.md` (modify) | — | Setup guide + documented security gap |

**Salvage:** port `client.ts`, `format.ts`, `state.ts` from `origin/crew/telegram` (`src/control/telegram/*`), then rebrand, re-home to `packages/core`, fix ESM `.js` imports, and align to the interfaces below. Do **not** port `subsystem.ts` (built on the deleted relay) — `bridge.ts` is a rewrite.

---

## Wave 1 — Foundations (no daemon wiring; each task independently testable)

### Task 1: TelegramConfig schema (shared)

**Files:** Modify `packages/shared/src/config.ts`; Test `packages/shared/src/__tests__/config.telegram.test.ts`

**Interfaces — Produces:**
```ts
export interface TelegramConfig {
  botToken?: string;        // falls back to env TELEGRAM_BOT_TOKEN at read time
  supergroupId: number;     // forum supergroup hosting per-project topics
  chats: number[];          // chat_id allowlist (inbound honored only from these)
  pollMs?: number;          // getUpdates long-poll cadence (default 1000)
}
// on SquadrantConfig:  telegram?: TelegramConfig;
```

- [ ] **TDD:** Test that a config JSON containing a `telegram` block round-trips through `loadConfig`/type-check with the fields above; and that a config with **no** `telegram` key is still valid (optional). Then add the type. Verify `getDefaultConfig()` is unchanged (no telegram by default).
- [ ] **Gate:** `pnpm -C packages/shared test` green; `pnpm build` clean.
- [ ] **Commit:** `feat(telegram): add optional TelegramConfig to shared config schema`

### Task 2: Pure formatters (core)

**Files:** Create `packages/core/src/telegram/format.ts`; Test `packages/core/src/telegram/__tests__/format.test.ts`

**Interfaces — Produces:**
```ts
export function topicName(project: string): string;                    // e.g. "squadrant"
export function formatLifecycle(project: string, ev: ControlEvent): string; // outbound text
export function formatInbound(text: string): string;                   // captain-pane text for a reply
```

- [ ] **TDD:** Assert exact output strings for a `task.done`, `task.blocked`, and `task.idle` event, and that `formatInbound` prefixes/labels a reply so the captain can tell it came from Telegram. Pure functions — no I/O, no mocks.
- [ ] **Gate:** `pnpm -C packages/core test telegram/format` green.
- [ ] **Commit:** `feat(telegram): pure outbound/inbound formatters`

### Task 3: State (offset + topic registry) (core)

**Files:** Create `packages/core/src/telegram/state.ts`; Test `packages/core/src/telegram/__tests__/state.test.ts`

**Interfaces — Produces:**
```ts
export interface TelegramState { offset: number; topics: Record<string, number>; } // key = `${project}::${scope}`
export function topicKey(project: string, scope?: string): string;   // scope defaults to "project"
export function loadState(stateRoot: string): TelegramState;
export function saveState(stateRoot: string, s: TelegramState): void;
export function setTopic(stateRoot: string, project: string, topicId: number, scope?: string): void;
export function findProjectByThread(stateRoot: string, threadId: number): { project: string; scope: string } | null;
```

- [ ] **TDD:** Round-trip `save`→`load`; `setTopic` then `findProjectByThread` returns the right `(project, scope)`; missing file ⇒ `{offset:0, topics:{}}`; default scope is `"project"`. Use a temp `stateRoot`.
- [ ] **Gate:** `pnpm -C packages/core test telegram/state` green.
- [ ] **Commit:** `feat(telegram): persistent offset + (project,scope) topic registry`

### Task 4: Bot API client (core) + devDep

**Files:** Create `packages/core/src/telegram/client.ts`; Test `packages/core/src/telegram/__tests__/client.test.ts`; Modify root `package.json` (devDependencies)

**Interfaces — Produces:**
```ts
export interface TelegramClient {
  getUpdates(offset: number, timeoutSec?: number): Promise<Update[]>;          // long-poll
  sendMessage(chatId: number, threadId: number | undefined, text: string): Promise<void>;
  createForumTopic(chatId: number, name: string): Promise<number>;             // returns message_thread_id
}
export function createTelegramClient(opts: { token: string; fetch?: typeof fetch }): TelegramClient;
```

- [ ] **Add devDependency** `@grammyjs/types` (types-only) and import `Update`/`Message` from it. Confirm it does **not** appear in the runtime bundle.
- [ ] **TDD:** Inject a fake `fetch`; assert `getUpdates` calls the right URL with `offset`/`timeout`, `sendMessage` posts `chat_id`+`message_thread_id`+`text`, `createForumTopic` returns the parsed `message_thread_id`. Assert a non-2xx response is surfaced as a rejected promise (so the bridge can catch it).
- [ ] **Gate:** `pnpm -C packages/core test telegram/client` green; `pnpm build` clean; grep the bundle to confirm no grammy runtime code.
- [ ] **Commit:** `feat(telegram): fetch-based Bot API client (+@grammyjs/types devDep)`

## Wave 2 — Delivery integration

### Task 5: `captain.message` mailbox kind (core)

**Files:** Modify `packages/core/src/mailbox.ts`; Test `packages/core/src/__tests__/mailbox.captain-message.test.ts`

**Interfaces — Produces:**
```ts
// Widen MailboxEntry.kind to include "captain.message" (an external, non-ControlEvent message).
export function appendCaptainMessage(opts: {
  stateRoot: string; project: string; text: string; source: "telegram";
}): Promise<void>;
```

- [ ] **Consumes:** existing `appendToMailbox`, `readFromCursor`, `MailboxEntry` (mailbox.ts).
- [ ] **TDD:** `appendCaptainMessage` writes an entry whose `kind==="captain.message"` and `message` is the rendered text, with a monotonic `seq`; `readFromCursor` for the `"captain"` subscriber yields it in order. Confirm the existing delivery loop's `deliverable()` returns the message (non-empty) so it will be delivered to the captain pane.
- [ ] **Gate:** `pnpm -C packages/core test mailbox` green (existing mailbox tests still pass).
- [ ] **Commit:** `feat(telegram): captain.message mailbox kind for inbound external messages`

## Wave 3 — The bridge

### Task 6: TelegramBridge (core)

**Files:** Create `packages/core/src/telegram/bridge.ts`, `packages/core/src/telegram/index.ts`; Test `packages/core/src/telegram/__tests__/bridge.test.ts`

**Interfaces — Produces:**
```ts
export interface TelegramBridge {
  start(): void;
  stop(): void;
  pushLifecycle(project: string, ev: ControlEvent): void;  // outbound, best-effort, never throws
}
export function createTelegramBridge(opts: {
  cfg: TelegramConfig; stateRoot: string;
  client: TelegramClient;                                   // injected (real one built by caller)
  appendCaptainMessage: (a:{stateRoot:string;project:string;text:string;source:"telegram"})=>Promise<void>;
  log: (msg: string) => void;
}): TelegramBridge;
```

- [ ] **Consumes:** Task 2 formatters, Task 3 state, Task 4 client, Task 5 `appendCaptainMessage`.
- [ ] **TDD — outbound:** `pushLifecycle` calls `client.sendMessage` to the project's topic (creating the topic via `createForumTopic` + `setTopic` on first use); a `sendMessage` that rejects is swallowed (the call resolves, error logged) — **crash-containment** is the key assertion.
- [ ] **TDD — inbound:** feed fake `getUpdates` returning a message with an allowlisted `chat_id` and a known `message_thread_id` ⇒ `appendCaptainMessage` is called with the resolved project; a **non-allowlisted** `chat_id` ⇒ dropped (no append); offset advances and persists; a throwing `getUpdates` does not escape `start()` (loop catches and continues).
- [ ] **Gate:** `pnpm -C packages/core test telegram/bridge` green.
- [ ] **Commit:** `feat(telegram): crash-contained bridge (outbound push + inbound poll)`

## Wave 4 — Wiring + CLI

### Task 7: Daemon wiring (cli + core)

**Files:** Modify `packages/cli/src/control/squadrantd.ts`, `packages/core/src/daemon/start.ts`; Test `packages/core/src/daemon/__tests__/start.telegram.test.ts`

- [ ] **Consumes:** `createTelegramBridge` (Task 6), `createTelegramClient` (Task 4), `loadConfig().telegram`, the existing `notify` composition point and start/stop in `start.ts` (follow `CmuxEventsBridge` wiring exactly).
- [ ] **TDD:** with `config.telegram` **absent**, no bridge is constructed and `notify` behaves exactly as before (regression guard). With `config.telegram` present, the daemon (a) builds the bridge, (b) composes `pushLifecycle` onto the notify fan-out (a captain notification also pushes to Telegram), (c) calls `bridge.start()` in boot and `bridge.stop()` in shutdown. Use the existing daemon test harness; inject a fake bridge to assert start/stop/compose without real network.
- [ ] **Gate:** `pnpm -C packages/core test` green; daemon boots in a test.
- [ ] **Commit:** `feat(telegram): wire bridge into the daemon (opt-in, composed onto notify)`

### Task 8: CLI command (cli)

**Files:** Create `packages/cli/src/commands/telegram.ts`; Modify `packages/cli/src/index.ts`; Test `packages/cli/src/commands/__tests__/telegram.test.ts`

**Interfaces — Produces:** `export const telegramCommand: Command;` (commander) with subcommands `link <project>` and `status`.

- [ ] **TDD:** `status` with no token/config prints `token: unset` / `no projects linked` and exits 0 (no crash). `link <project>` resolves the project, ensures a forum topic exists (via client `createForumTopic` + `setTopic`), and prints the bound topic id; assert via injected client/state. Register `telegramCommand` in `index.ts` and assert `squadrant telegram --help` lists both subcommands.
- [ ] **Gate:** `node dist/index.js telegram status` runs without crashing; `pnpm -C packages/cli test` green.
- [ ] **Commit:** `feat(telegram): squadrant telegram link|status command`

## Wave 5 — Docs + final gate

### Task 9: Docs + verification

**Files:** Modify `README.md`, `AGENTS.md`

- [ ] Document setup (create bot, get token, create forum supergroup, `squadrant telegram link <project>`, config block) and **the security gap** (chat membership ⇒ captain control; user-id allowlist deferred to #321). Note `link`↔daemon 409 interim workaround (link with daemon stopped) per #321 MAJOR-4.
- [ ] **Final gates (run on the authoritative checkout, once):** `pnpm install && pnpm build && pnpm test` (green vs known baseline — note any pre-existing flaky relay-proxy fails); `node dist/index.js --help` (ESM gate); `node dist/index.js telegram status` (no-config no-crash).
- [ ] **Commit:** `docs(telegram): setup guide + security note for v1`

---

## Self-review (against the spec)

- **Spec coverage:** outbound (Tasks 6–7) · inbound captain-only (Tasks 5–6) · opt-in/crash-contained (Tasks 6–7) · config (Task 1) · client plain-fetch+devDep (Task 4) · topology supergroup/topic-per-project + `(project,scope)` key (Tasks 3,6) · CLI link/status (Task 8) · security allowlist + documented gap (Tasks 6,9) · testing per component (every task) · salvage from #316 (Tasks 2–4 notes). All spec sections map to a task. ✓
- **Deferred correctly:** per-crew routing, #321 hardening, #309 buttons — not in any task, called out in spec + Task 9 docs. ✓
- **Type consistency:** `(project,scope)` key (`topicKey`/`findProjectByThread`) consistent across Tasks 3/6; `appendCaptainMessage` signature identical in Tasks 5/6; `TelegramClient` methods identical in Tasks 4/6/8. ✓
- **No runtime dep:** only `@grammyjs/types` devDep (Task 4) — bundle-checked. ✓
