# Daemon Auto-Restart on Config Write — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Daemon-cached config writes (`telegram setup`, `config set <daemon-key>`, `projects add`) auto-restart the daemon (reusing existing recovery) so changes take effect. Headless-in-flight guard is deferred to **#410**.

**Architecture:** One shared, injectable `restartDaemonIfRunning` helper that wraps the existing launchd kickstart path (the one `heal daemon` already uses). A pure `isDaemonCachedKey` gate decides which `config set` keys warrant a restart. Wire the helper into the three write paths.

**Tech Stack:** TypeScript (NodeNext ESM — relative imports end in `.js`), vitest, commander.

## Global Constraints

- **ESM `.js` extensions** on every relative import.
- **Reuse, don't reinvent:** the kickstart path already exists in `packages/core/src/launchd.ts` (`kickstartArgv`, `LABEL`, `daemonLock`/`restartInFlight`) and `packages/cli/src/commands/heal.ts` (the `heal daemon` restart flow). Extract one shared helper; refactor `heal daemon` to call it (no behavior change).
- **Mockable:** the helper takes an injectable kickstart runner + daemon-running probe so tests NEVER bounce a real daemon.
- **Skip under test:** `process.env.VITEST` → never restart.
- **Deferred:** do NOT add a headless-in-flight guard (that's #410).
- Single-file tests: `npx vitest run <path>`; full suite once at the end.

---

### Task 1: `isDaemonCachedKey` pure gate

**Files:**
- Create: `packages/shared/src/daemon-keys.ts` (or add to an existing shared module)
- Test: `packages/shared/src/__tests__/daemon-keys.test.ts`

**Interfaces:**
- Produces: `isDaemonCachedKey(dottedKey: string): boolean`

- [ ] **Step 1: Failing test**
```ts
import { isDaemonCachedKey } from "../daemon-keys.js";
it("flags daemon-cached keys", () => {
  for (const k of ["telegram.remoteControl", "telegram.notify.crew", "defaults.taskTimeoutMs", "defaults.cmuxEventsBridge", "projects.brove"])
    expect(isDaemonCachedKey(k)).toBe(true);
});
it("ignores fresh-read keys", () => {
  for (const k of ["defaults.effort", "defaults.crewRouting.rules", "models.crew"])
    expect(isDaemonCachedKey(k)).toBe(false);
});
```
- [ ] **Step 2: Run → fail** — `npx vitest run packages/shared/src/__tests__/daemon-keys.test.ts`
- [ ] **Step 3: Implement**
```ts
const DAEMON_CACHED_PREFIXES = ["telegram.", "defaults.taskTimeoutMs", "defaults.cmuxEventsBridge", "projects."];
export function isDaemonCachedKey(dottedKey: string): boolean {
  return DAEMON_CACHED_PREFIXES.some((p) => dottedKey === p || dottedKey.startsWith(p));
}
```
- [ ] **Step 4: Run → pass**
- [ ] **Step 5: Commit** — `git commit -m "feat(config): isDaemonCachedKey — which config keys the daemon caches at boot"`

---

### Task 2: `restartDaemonIfRunning` shared helper + refactor heal

**Files:**
- Create: `packages/cli/src/control/restart-daemon.ts`
- Modify: `packages/cli/src/commands/heal.ts` (call the new helper — no behavior change)
- Test: `packages/cli/src/control/__tests__/restart-daemon.test.ts`

**Interfaces:**
- Produces:
```ts
type RestartOutcome = "restarted" | "skipped-not-running" | "skipped-opt-out";
function restartDaemonIfRunning(opts: {
  reason: string;
  noRestart?: boolean;
  isRunning?: () => boolean;     // default: real daemon-liveness probe
  runKickstart?: () => void;     // default: real launchd kickstart (-k) via launchd.ts
  env?: NodeJS.ProcessEnv;       // default process.env (for VITEST check)
  log?: (m: string) => void;     // default console.log
}): RestartOutcome;
```

- [ ] **Step 1: Failing test** (all injected — no real daemon touched)
```ts
import { restartDaemonIfRunning } from "../restart-daemon.js";
const base = { reason: "x", env: {} as any };
it("opt-out via noRestart", () => {
  let ran = false;
  expect(restartDaemonIfRunning({ ...base, noRestart: true, isRunning: () => true, runKickstart: () => { ran = true; } })).toBe("skipped-opt-out");
  expect(ran).toBe(false);
});
it("skips when daemon not running", () => {
  let ran = false;
  expect(restartDaemonIfRunning({ ...base, isRunning: () => false, runKickstart: () => { ran = true; } })).toBe("skipped-not-running");
  expect(ran).toBe(false);
});
it("restarts when running", () => {
  let ran = false;
  expect(restartDaemonIfRunning({ ...base, isRunning: () => true, runKickstart: () => { ran = true; } })).toBe("restarted");
  expect(ran).toBe(true);
});
it("never restarts under VITEST env", () => {
  let ran = false;
  expect(restartDaemonIfRunning({ reason: "x", env: { VITEST: "1" } as any, isRunning: () => true, runKickstart: () => { ran = true; } })).toBe("skipped-opt-out");
  expect(ran).toBe(false);
});
```
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement** `restart-daemon.ts` — defaults wired to the real liveness probe + `launchd.ts` kickstart (reuse `kickstartArgv(LABEL, true)` via the same exec path `heal.ts` uses today; reuse `daemonLock`/`restartInFlight` to debounce). Order: `env.VITEST || noRestart` → `skipped-opt-out`; `!isRunning()` → `skipped-not-running`; else `runKickstart()` + log `↻ restarting daemon to apply ${reason}…` → `restarted`.
- [ ] **Step 4: Refactor `heal daemon`** to call `restartDaemonIfRunning({ reason: "heal", isRunning: () => true })` (or keep heal's unconditional restart but routed through the helper's `runKickstart`). Keep heal's existing output. Confirm `heal`'s own tests still pass.
- [ ] **Step 5: Run → pass** — `npx vitest run packages/cli/src/control/__tests__/restart-daemon.test.ts packages/cli/src/commands/__tests__/heal*.test.ts`
- [ ] **Step 6: Commit** — `git commit -m "feat(daemon): restartDaemonIfRunning shared helper; heal routes through it"`

---

### Task 3: Wire into the three write paths

**Files:**
- Modify: `packages/cli/src/commands/telegram.ts`, `packages/cli/src/commands/config.ts`, `packages/cli/src/commands/projects.ts`
- Test: extend each command's test file

**Interfaces:**
- Consumes: `restartDaemonIfRunning`, `isDaemonCachedKey`.

- [ ] **Step 1: Failing tests**
  - `config.test.ts`: `config set defaults.effort low` does NOT invoke the restart helper (inject a spy); `config set telegram.notify.crew none` DOES; `--no-restart` suppresses it. (Refactor the action to take an injectable restart fn, default the real one.)
  - `telegram.test.ts`: the `setup` flow calls the restart helper once after writing config (inject a fake; assert called with reason mentioning telegram).
  - `projects.test.ts`: register/add calls the restart helper after writing `config.projects`.
- [ ] **Step 2: Run → fail**
- [ ] **Step 3: Implement**
  - `config set`: after the write, `if (isDaemonCachedKey(key) && !opts.noRestart) print(restartDaemonIfRunning({ reason: \`config ${key}\` }))` else if cached-but-no-restart print the heal hint. Add `--no-restart` option.
  - `telegram setup`: after config write + command registration, `restartDaemonIfRunning({ reason: "telegram config" })`; print outcome.
  - `projects add`/register: after writing projects, `restartDaemonIfRunning({ reason: "project registration", noRestart: opts.noRestart })`; add `--no-restart`.
  - Print outcomes consistently: `restarted` → `↻ restarting daemon…`; `skipped-not-running` → `(daemon not running — applies on next start)`; `skipped-opt-out` → `(run 'squadrant heal daemon' to apply)`.
- [ ] **Step 4: Run → pass**
- [ ] **Step 5: Build + gate** — `pnpm build && node dist/index.js config set --help` (shows `--no-restart`) and `node dist/index.js --help` (no crash)
- [ ] **Step 6: Commit** — `git commit -m "feat(cli): auto-restart daemon after daemon-cached config writes (setup/config set/projects)"`

---

### Task 4: Suite + CHANGELOG + #410 note

- [ ] **Step 1: Full suite once** — `npx vitest run` (2 known bridge/launch timeout flakes acceptable baseline).
- [ ] **Step 2: CHANGELOG**
```markdown
### Added
- **Daemon auto-restarts when you change daemon-cached config.** `squadrant telegram setup`, `squadrant config set <telegram.*|defaults.taskTimeoutMs|defaults.cmuxEventsBridge|projects.*>`, and project registration now restart the daemon so the change takes effect immediately (was: silently stale until a manual `squadrant heal daemon`). Use `--no-restart` to opt out. Interactive crews + tasks + Telegram state recover automatically via the disk store + boot reconcile.

### Known issues
- A config-write restart can orphan in-flight **headless** crews (interactive crews recover fine) — see #410.
```
- [ ] **Step 3: Commit** — `git commit -m "docs: changelog for daemon auto-restart on config write (#410 noted)"`

---

## Self-Review
- Option B across all three write paths → Task 3 ✓
- Reuse existing recovery (no new snapshot) → helper only triggers the existing kickstart ✓
- Daemon-cached-key gate → Task 1 ✓
- Guards: not-running, opt-out, VITEST → Task 2 ✓
- Headless guard intentionally absent → tracked in #410, CHANGELOG note ✓
- **Types:** `RestartOutcome` + helper signature consistent across Tasks 2–3; `isDaemonCachedKey` consumed in Task 3.
