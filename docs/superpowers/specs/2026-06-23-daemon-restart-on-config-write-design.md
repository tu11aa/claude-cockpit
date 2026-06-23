# Daemon Auto-Restart on Config Write — Design

**Date:** 2026-06-23
**Status:** Approved (option B) — ready for planning
**Scope:** `@squadrant/cli` (telegram setup, config set, projects) + a shared restart helper
**Deferred gap:** in-flight headless crews orphaned by `-k` → **issue #410** (not guarded in this slice)

## Problem

The daemon reads config **once at boot** (`squadrantd.ts:140` caches `telegram`; `start.ts:120` caches `projects`; `context.ts:140` caches `taskTimeoutMs`; `start.ts:181` caches `cmuxEventsBridge`). CLI writes to those keys don't reach the running daemon until it restarts. Today the user must know to run `squadrant heal daemon` by hand — and often doesn't (e.g. `telegram setup` enabling `remoteControl` had no effect until a manual restart).

## Goal

Daemon-cached config writes **automatically restart the daemon** so the change takes effect, reusing the daemon's existing recovery (disk-backed store + boot reconcile + `cmux-events.seq` cursor → interactive crews + tasks + telegram rehydrate).

## Decisions

1. **Option B:** auto-restart after **every** daemon-cached config write — `telegram setup`, `config set <daemon-key>`, `projects add`/register.
2. **Reuse existing recovery** — no new snapshot. The store already persists every crew registration (incl. `surface`); boot recovery + the persisted cmux-events cursor rehydrate them.
3. **Reuse the existing restart path** — the same launchd kickstart the `heal daemon` command uses (`launchd.ts` `kickstartArgv` + the `heal.ts` restart flow). Extract it into one shared helper.
4. **Headless guard deferred** → #410. This slice does NOT check for in-flight headless crews (accepted risk).

## Design

### Shared helper

`restartDaemonIfRunning(opts: { reason: string; noRestart?: boolean }): "restarted" | "skipped-not-running" | "skipped-opt-out"`

- `noRestart` true, or `process.env.VITEST`, or non-interactive where inappropriate → return `skipped-opt-out`.
- Daemon **not running** (no live pid / unreachable) → `skipped-not-running` (the next natural start reads fresh config; nothing to do).
- Else → run the launchd kickstart (`-k`, reusing `kickstartArgv`/`heal` path) under the existing `daemonLock`/`restartInFlight` debounce; print `↻ restarting daemon to apply <reason>…`; return `restarted`.

Single source of truth — both `heal daemon` and the config commands call it.

### Daemon-cached key set (for `config set`)

Restart **only** when the dotted key starts with one of:
- `telegram.` (whole block cached in the bridge)
- `defaults.taskTimeoutMs`
- `defaults.cmuxEventsBridge`
- `projects.`

Other keys (`defaults.effort`, `defaults.crewRouting`, `models.*` — read fresh at crew-spawn) → **no restart**. A pure `isDaemonCachedKey(key): boolean` decides this (unit-tested).

### Wiring

- **`telegram setup`** — after writing config + registering commands, call `restartDaemonIfRunning({ reason: "telegram config" })`. (Interactive + infrequent → near-always restarts cleanly.)
- **`config set <key> <value>`** — after the write, if `isDaemonCachedKey(key)`, call the helper. Add a `--no-restart` flag.
- **`projects add`/register** — after writing `config.projects`, call the helper (reason `"project registration"`). `--no-restart` flag.
- Each prints the helper's outcome: `↻ restarting…`, or `(daemon not running — change applies on next start)`, or `(--no-restart — run 'squadrant heal daemon' to apply)`.

## Non-goals (this slice)

- **No headless-in-flight guard** (#410).
- No daemon hot-reload (config file watch) — restart is the mechanism.
- No change to the recovery path itself (it already works for interactive/codex crews).

## Testing

- **Pure:** `isDaemonCachedKey` — true for `telegram.x`, `defaults.taskTimeoutMs`, `defaults.cmuxEventsBridge`, `projects.x`; false for `defaults.effort`, `models.crew`, `defaults.crewRouting`.
- **Helper:** `noRestart` → `skipped-opt-out`; daemon-down (injected probe) → `skipped-not-running`; daemon-up → invokes the kickstart fn once (fake it) → `restarted`; VITEST env → skipped.
- **Wiring:** `config set defaults.effort low` does NOT call the helper; `config set telegram.notify.crew none` DOES; `--no-restart` suppresses it.
- Keep the kickstart itself mockable (inject the runner) so tests never bounce a real daemon.
