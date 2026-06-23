# Telegram Command-Menu Registration + Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The CLI registers the bot's `/` command menu with Telegram (`setMyCommands`) — automatically in `telegram setup` and via a standalone `telegram register-commands` — plus a `squadrant:telegram` skill documenting setup/remote-control/commands/notifications.

**Architecture:** Add `setMyCommands` to `TelegramClient`; a curated `BOT_COMMANDS` menu; a `register-commands` subcommand; a best-effort registration call inside `setup`. New portable skill under `plugin/skills/telegram/`.

**Tech Stack:** TypeScript (NodeNext ESM — relative imports end in `.js`), vitest, commander.

## Global Constraints

- **ESM `.js` extensions** on every relative import.
- **Best-effort in setup:** a `setMyCommands` failure prints a warning; setup still completes.
- **No change to command execution / auth (Gate 2) logic.**
- Single-file tests: `npx vitest run <path>`; full suite once at the end.
- Skill is portable markdown (Claude reads via Skill tool; other agents via AGENTS.md) — match the shape of existing `plugin/skills/set-effort/SKILL.md`.

---

### Task 1: `setMyCommands` on the client + curated menu

**Files:**
- Modify: `packages/core/src/telegram/client.ts`
- Create: `packages/core/src/telegram/bot-commands.ts`
- Test: `packages/core/src/telegram/client.test.ts` (extend) + `packages/core/src/telegram/__tests__/bot-commands.test.ts`

**Interfaces:**
- Produces:
  - `client.setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void>` (POST `setMyCommands`)
  - `export const BOT_COMMANDS: Array<{ command: string; description: string }>` in `bot-commands.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/bot-commands.test.ts`:
```ts
import { BOT_COMMANDS } from "../bot-commands.js";
it("exposes the curated user-facing menu", () => {
  const names = BOT_COMMANDS.map((c) => c.command);
  expect(names).toEqual(["status", "projects", "crews", "notify", "mute", "unmute", "help"]);
  for (const c of BOT_COMMANDS) expect(c.description.length).toBeGreaterThan(0);
});
```

In `client.test.ts` (reuse its fake-fetch harness): assert `setMyCommands([...])` POSTs to the `setMyCommands` method with `{commands}` body and resolves; on a non-ok API response it rejects.

- [ ] **Step 2: Run → fail**

Run: `npx vitest run packages/core/src/telegram/__tests__/bot-commands.test.ts packages/core/src/telegram/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`bot-commands.ts`:
```ts
export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "status", description: "squadrant status" },
  { command: "projects", description: "list registered projects" },
  { command: "crews", description: "list crews for a project" },
  { command: "notify", description: "notifications: /notify crew <tier> | cap <on|off>" },
  { command: "mute", description: "mute a project's topic" },
  { command: "unmute", description: "unmute a project's topic" },
  { command: "help", description: "list commands" },
];
```

In `client.ts`, add to the interface and the implementation (mirror the existing `call(...)` helper):
```ts
setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void>;
// impl:
async setMyCommands(commands) { await call<boolean>("setMyCommands", { commands }); },
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run packages/core/src/telegram/__tests__/bot-commands.test.ts packages/core/src/telegram/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/telegram/client.ts packages/core/src/telegram/bot-commands.ts packages/core/src/telegram/client.test.ts packages/core/src/telegram/__tests__/bot-commands.test.ts
git commit -m "feat(telegram): setMyCommands client method + curated BOT_COMMANDS menu"
```

---

### Task 2: `register-commands` subcommand + setup integration

**Files:**
- Modify: `packages/cli/src/commands/telegram.ts`
- Test: `packages/cli/src/commands/__tests__/telegram.test.ts`

**Interfaces:**
- Consumes: `BOT_COMMANDS` from `@squadrant/core`; `createTelegramClient`.
- Produces: `runRegisterCommands(opts: { client: TelegramClient }): Promise<void>` — calls `client.setMyCommands(BOT_COMMANDS)`.

- [ ] **Step 1: Write failing test**

In `telegram.test.ts`:
```ts
import { runRegisterCommands } from "../telegram.js";
it("registers the curated menu", async () => {
  const calls: any[] = [];
  const client: any = { setMyCommands: async (c: any) => { calls.push(c); } };
  await runRegisterCommands({ client });
  expect(calls).toHaveLength(1);
  expect(calls[0].map((c: any) => c.command)).toContain("notify");
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run packages/cli/src/commands/__tests__/telegram.test.ts`
Expected: FAIL — `runRegisterCommands` not exported.

- [ ] **Step 3: Implement**

In `telegram.ts`: import `BOT_COMMANDS`. Add:
```ts
export async function runRegisterCommands(opts: { client: TelegramClient }): Promise<void> {
  await opts.client.setMyCommands(BOT_COMMANDS);
}
```
Register a subcommand `telegram register-commands` (token-gated like `link`/`send`): build a client, call `runRegisterCommands`, print `chalk.green("registered " + BOT_COMMANDS.length + " bot commands")`.

In the `setup` action, after `writeTelegramConfig(...)` succeeds, best-effort register:
```ts
try { await runRegisterCommands({ client }); console.log(chalk.dim("Registered the /command menu.")); }
catch (e) { console.log(chalk.yellow(`command-menu registration skipped: ${(e as Error).message}`)); }
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run packages/cli/src/commands/__tests__/telegram.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + gate**

Run: `pnpm build && node dist/index.js telegram register-commands --help`
Expected: prints (no ESM crash).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/telegram.ts packages/cli/src/commands/__tests__/telegram.test.ts
git commit -m "feat(telegram): register-commands subcommand + auto-register menu in setup"
```

---

### Task 3: `squadrant:telegram` skill

**Files:**
- Create: `plugin/skills/telegram/SKILL.md`

- [ ] **Step 1: Write the skill**

Frontmatter (match `plugin/skills/set-effort/SKILL.md` shape):
```markdown
---
name: telegram
description: Set up and manage the squadrant↔Telegram integration — bot setup, remote control, command-menu registration, and per-project notification tuning (mute, crew tiers, cap). Use when the user asks about Telegram setup, "why don't commands work", registering the /command menu, or muting/tuning notifications.
---
```
Body sections (concise, command-first):
- **Setup:** `squadrant telegram setup` → token, supergroup auto-detect, **say YES to remote control** (captures user-id, enables Gate 2). Re-run if `remoteControl` is off.
- **Two gates:** chats allowlist (talk) vs remoteControl + user-id (command). Link `docs/diagrams/2026-06-23-telegram-daemon-architecture.html`.
- **Register the `/` menu:** `squadrant telegram register-commands` (setup does it automatically).
- **Notifications:** `squadrant telegram notify <p> on|off | crew <all|alert_only|done_only|none> | cap <on|off>` and `--status`; TG: `/notify`, `/mute`, `/unmute`.
- **Troubleshooting:** "⛔ not authorized" → remoteControl off / wrong user-id (re-run setup); "no `/` menu" → `register-commands`; "topic silent" → `notify --status`; mute confirmations now post to the topic (#408).

- [ ] **Step 2: Verify frontmatter + referenced commands exist**

Run: `node dist/index.js telegram --help` and confirm `setup`, `register-commands`, `notify` are listed; confirm the SKILL.md frontmatter has `name` + `description`.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/telegram/SKILL.md
git commit -m "feat(skills): squadrant:telegram skill — setup, commands, notifications"
```

---

### Task 4: Full suite + CHANGELOG

- [ ] **Step 1: Full suite once**

Run: `npx vitest run`
Expected: PASS (the 2 known pre-existing bridge/launch timeout flakes are acceptable baseline; nothing new red). Run ONCE.

- [ ] **Step 2: CHANGELOG**

```markdown
### Added
- **Telegram `/command` menu registration.** `squadrant telegram setup` now registers the bot's command menu, and `squadrant telegram register-commands` (re)registers it on demand — so `/status`, `/notify`, `/mute`, etc. appear in Telegram's `/` autocomplete.
- **`squadrant:telegram` skill** documenting setup, remote control, command registration, and notification tuning.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(telegram): changelog for command-menu registration + skill"
```

---

## Self-Review

- `setMyCommands` client + curated menu → Task 1 ✓
- `register-commands` subcommand + setup auto-register (best-effort) → Task 2 ✓
- `squadrant:telegram` skill → Task 3 ✓
- No change to Gate 2 auth / execution → none of the tasks touch `auth.ts`/`commands.ts` ✓
- **Types:** `BOT_COMMANDS` shape (`{command,description}[]`) consistent across client (Task 1) and CLI (Task 2).
