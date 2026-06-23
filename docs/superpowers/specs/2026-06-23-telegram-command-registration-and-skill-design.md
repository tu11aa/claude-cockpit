# Telegram Command-Menu Registration + Skill — Design

**Date:** 2026-06-23
**Status:** Approved (user-requested) — ready for planning
**Scope:** `@squadrant/core` TelegramClient + `@squadrant/cli` telegram command + a new `squadrant:telegram` skill
**Builds on:** command channel (#402), remoteControl (#321), notify tiers (#406/#407)

## Problem

1. The Telegram command channel exists (`/status`, `/notify`, `/mute`…), but the bot's **command menu is never registered** with Telegram (`getMyCommands` → `[]`), so the user sees no `/` autocomplete and doesn't know what commands exist.
2. Setup is opaque: the user ran `squadrant telegram setup` but `remoteControl` ended up OFF, and there's no single place that explains the setup → remoteControl → commands → notifications flow. We want this captured as a reusable **skill**.

## Goal

- The CLI **registers the bot command menu** (`setMyCommands`) — automatically during `telegram setup`, and via a standalone `squadrant telegram register-commands`.
- A `squadrant:telegram` **skill** documents and drives setup, remote-control enablement, command registration, and notification tuning.

## Design

### A. `setMyCommands` in the client

Add to `TelegramClient` (`packages/core/src/telegram/client.ts`):
```ts
setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void>;
```
POST `setMyCommands` to the Bot API. Errors propagate (caller decides how to surface).

### B. The curated command list

A single exported constant — the menu shown in Telegram. Mirrors the curated registry (`commands.ts`) + the project-topic toggles:
```
status      – squadrant status
projects    – list registered projects
crews       – list crews for a project
notify      – set notifications: /notify crew <tier> | cap <on|off>
mute        – mute a project's topic
unmute      – unmute a project's topic
help        – list commands
```
(Keep it to the user-facing, safe verbs. `spawn`/`launch`/`config` stay available but need not clutter the menu — decide in the plan; default: include `status, projects, crews, notify, mute, unmute, help`.)

### C. CLI surfaces

- **`squadrant telegram register-commands`** — standalone: load token, `setMyCommands(MENU)`, print confirmation. Idempotent.
- **`telegram setup`** — after writing config, **also call `setMyCommands(MENU)`** so a single setup run registers the menu. Best-effort: a registration failure warns but doesn't fail setup.
- Both gate on a token being present (same as `link`/`send`).

> **Pairing with remoteControl:** the menu lists commands that only *work* when `remoteControl` is on (Gate 2). Registering into `setup` (which is also where remoteControl is enabled) keeps them in sync. The standalone command is for re-registering later.

### D. The `squadrant:telegram` skill

A portable markdown skill (same shape as the other `squadrant:*` skills) that covers:
- **Setup:** `squadrant telegram setup` → token, supergroup auto-detect, **enable remote control (say yes)** to capture user-id + flip Gate 2.
- **The two gates** (chats allowlist vs remoteControl + user-id) — link the architecture HTML.
- **Register the command menu:** `squadrant telegram register-commands`.
- **Notification tuning:** `squadrant telegram notify <p> on|off | crew <tier> | cap <on|off>` and `--status`; the TG equivalents `/notify` `/mute` `/unmute`.
- **Troubleshooting:** "commands say not authorized" → remoteControl off / wrong user-id; "no `/` menu" → run register-commands; "topic went silent" → check `notify --status`.

Place under the repo's skills source dir (same location as the existing `squadrant:*` skills) with a `SKILL.md` and frontmatter (`name`, `description`).

## Non-goals

- No change to the command **execution** path or auth (Gate 2 logic unchanged).
- No auto-registration on every daemon boot (explicit CLI action only).
- No new config keys.

## Testing

- **Client:** `setMyCommands` POSTs the right payload (fake fetch) and throws on API error.
- **CLI:** `register-commands` calls `client.setMyCommands` with the curated MENU; `setup` calls it best-effort (a throw doesn't fail setup). Use the existing fake-client pattern.
- **Skill:** lints as valid markdown with required frontmatter; commands referenced exist in the CLI.
