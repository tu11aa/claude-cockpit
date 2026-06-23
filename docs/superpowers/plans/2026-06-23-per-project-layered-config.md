# Per-project Layered Config + Telegram Notification Tiers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-project config-override layer (`~/.config/squadrant/projects/<name>.json`) resolved as built-in → global → project, and make Telegram notifications its first tenant: per-project `cap`/`crew` tiers plus a config-default `active` that the live mute-state overrides.

**Architecture:** A generic resolver lives in `@squadrant/shared` (pure, file-backed, no daemon knowledge). The Telegram bridge in `@squadrant/core` consumes the resolved `NotifyConfig` and applies the live-active override from `telegram-state.json` on top. CLI and Telegram surfaces write the per-project override file for deliberate preference changes; `/mute`/`/unmute` keep writing live state (unchanged from #406).

**Tech Stack:** TypeScript (NodeNext ESM — relative imports MUST end in `.js`), commander CLI, vitest, pnpm monorepo (`shared ◄ core ◄ cli`).

## Global Constraints

- NodeNext ESM: every relative import ends in `.js` (e.g. `./project-config.js`). `node dist/index.js --help` is the real gate, not just tests.
- Additive only: an absent `projects/<name>.json`, an absent `telegram.notify` global block, and an unchanged `telegram-state.json` MUST all reproduce today's behavior exactly. No data migration.
- Built-in notify defaults (verbatim): `{ active: false, cap: true, crew: "alert_only" }`.
- Crew tier enum (verbatim): `"all" | "alert_only" | "done_only" | "none"`.
- Open decisions locked for this plan: cap/crew resolution = **project overrides global** (deep per-key merge); `done_only` = `{ task.done, task.failed }`.
- Karpathy: surgical changes only; no drive-by refactors of the touched files.
- Crash-containment in `bridge.ts` is invariant: no new throw may escape `deliverOutbound`/the poll loop.

---

## File Structure

- **Create** `packages/shared/src/project-config.ts` — override-file path/load/save + `NotifyConfig`, `DEFAULT_NOTIFY`, `deepMerge`, `resolveNotify`.
- **Create** `packages/shared/src/__tests__/project-config.test.ts`.
- **Modify** `packages/shared/src/config.ts` — add `notify?: Partial<NotifyConfig>` to `TelegramConfig`.
- **Modify** `packages/shared/src/index.ts` — export the new module.
- **Create** `packages/core/src/telegram/tiers.ts` — `tierIncludes(tier, eventType)`.
- **Create** `packages/core/src/telegram/__tests__/tiers.test.ts`.
- **Modify** `packages/core/src/telegram/bridge.ts` — `deliverOutbound` active-resolution + crew filter; `/notify` command parsing.
- **Modify** `packages/core/src/telegram/format.ts` — `failed`/`approval.requested`/`input.requested`/`timeout` cases.
- **Modify** `packages/cli/src/commands/telegram.ts` — `notify <project> crew <tier>` / `cap <on|off>`; `cap` gate on `send`.

Each task ends with `pnpm build` green and the named vitest file passing.

---

### Task 1: Per-project override file — load/save/path (shared)

**Files:**
- Create: `packages/shared/src/project-config.ts`
- Test: `packages/shared/src/__tests__/project-config.test.ts`

**Interfaces:**
- Produces: `projectConfigPath(name: string, root?: string): string`, `loadProjectOverride(name: string, root?: string): ProjectOverrideConfig`, `saveProjectOverride(name: string, patch: ProjectOverrideConfig, root?: string): void`, and the type `ProjectOverrideConfig`.
- `root` defaults to `path.join(os.homedir(), ".config", "squadrant")`; tests pass a temp dir.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProjectOverride, saveProjectOverride, projectConfigPath } from "../project-config.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sq-pc-"));
});

describe("project override file", () => {
  it("returns {} when the file is absent", () => {
    expect(loadProjectOverride("squadrant", root)).toEqual({});
  });

  it("round-trips a saved override", () => {
    saveProjectOverride("squadrant", { telegram: { notify: { crew: "all" } } }, root);
    expect(loadProjectOverride("squadrant", root)).toEqual({ telegram: { notify: { crew: "all" } } });
    expect(projectConfigPath("squadrant", root)).toBe(path.join(root, "projects", "squadrant.json"));
  });

  it("deep-merges on save, preserving sibling keys", () => {
    saveProjectOverride("squadrant", { telegram: { notify: { cap: false } } }, root);
    saveProjectOverride("squadrant", { telegram: { notify: { crew: "none" } } }, root);
    expect(loadProjectOverride("squadrant", root)).toEqual({ telegram: { notify: { cap: false, crew: "none" } } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/__tests__/project-config.test.ts`
Expected: FAIL — `Cannot find module '../project-config.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/project-config.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelRoutingConfig } from "./config.js";

export type CrewTier = "all" | "alert_only" | "done_only" | "none";

export interface NotifyConfig {
  active: boolean;
  cap: boolean;
  crew: CrewTier;
}

/** Per-project override layer. Every key optional; mirrors the global settings. */
export interface ProjectOverrideConfig {
  telegram?: { notify?: Partial<NotifyConfig> };
  // Reserved future tenants (resolver is already generic; consumers not yet wired):
  effort?: "max" | "balance" | "low";
  models?: Partial<ModelRoutingConfig>;
}

function defaultRoot(): string {
  return path.join(os.homedir(), ".config", "squadrant");
}

export function projectConfigPath(name: string, root = defaultRoot()): string {
  return path.join(root, "projects", `${name}.json`);
}

export function loadProjectOverride(name: string, root = defaultRoot()): ProjectOverrideConfig {
  try {
    return JSON.parse(fs.readFileSync(projectConfigPath(name, root), "utf-8")) as ProjectOverrideConfig;
  } catch {
    return {};
  }
}

/** Deep-merge a generic plain-object tree. Arrays/primitives in `patch` replace. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

export function saveProjectOverride(name: string, patch: ProjectOverrideConfig, root = defaultRoot()): void {
  const merged = deepMerge(loadProjectOverride(name, root), patch);
  const file = projectConfigPath(name, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/__tests__/project-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export + build**

Add to `packages/shared/src/index.ts` (follow the existing export style there):
```ts
export * from "./project-config.js";
```
Run: `pnpm build` → expect success.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/project-config.ts packages/shared/src/__tests__/project-config.test.ts packages/shared/src/index.ts
git commit -m "feat(config): per-project override file load/save with deep-merge"
```

---

### Task 2: Global `telegram.notify` schema + `resolveNotify` (shared)

**Files:**
- Modify: `packages/shared/src/config.ts:42-49` (add `notify?` to `TelegramConfig`)
- Modify: `packages/shared/src/project-config.ts` (add `DEFAULT_NOTIFY`, `resolveNotify`)
- Test: `packages/shared/src/__tests__/project-config.test.ts` (extend)

**Interfaces:**
- Consumes: `ProjectOverrideConfig` (Task 1), `TelegramConfig` (config.ts).
- Produces: `DEFAULT_NOTIFY: NotifyConfig`, `resolveNotify(globalNotify: Partial<NotifyConfig> | undefined, override: ProjectOverrideConfig): NotifyConfig` — built-in → global → project, per-key. Does NOT apply live state (that's the bridge's job).

- [ ] **Step 1: Write the failing test** (append to the file)

```ts
import { resolveNotify, DEFAULT_NOTIFY } from "../project-config.js";

describe("resolveNotify", () => {
  it("returns built-in defaults with no global and no override", () => {
    expect(resolveNotify(undefined, {})).toEqual({ active: false, cap: true, crew: "alert_only" });
    expect(DEFAULT_NOTIFY).toEqual({ active: false, cap: true, crew: "alert_only" });
  });

  it("global overrides built-in", () => {
    expect(resolveNotify({ crew: "done_only" }, {})).toEqual({ active: false, cap: true, crew: "done_only" });
  });

  it("project overrides global per-key, keeping siblings", () => {
    const r = resolveNotify({ cap: false, crew: "done_only" }, { telegram: { notify: { crew: "all" } } });
    expect(r).toEqual({ active: false, cap: false, crew: "all" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/__tests__/project-config.test.ts`
Expected: FAIL — `resolveNotify is not a function`.

- [ ] **Step 3: Implement**

In `config.ts`, extend `TelegramConfig` (keep existing fields):
```ts
  pollMs?: number;
  /** Global notification defaults (per-project override lives in projects/<name>.json). */
  notify?: { active?: boolean; cap?: boolean; crew?: "all" | "alert_only" | "done_only" | "none" };
```

In `project-config.ts`:
```ts
export const DEFAULT_NOTIFY: NotifyConfig = { active: false, cap: true, crew: "alert_only" };

export function resolveNotify(
  globalNotify: Partial<NotifyConfig> | undefined,
  override: ProjectOverrideConfig,
): NotifyConfig {
  let n: NotifyConfig = { ...DEFAULT_NOTIFY };
  if (globalNotify) n = deepMerge(n, globalNotify);
  if (override.telegram?.notify) n = deepMerge(n, override.telegram.notify);
  return n;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/__tests__/project-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Build + commit**

```bash
pnpm build
git add packages/shared/src/config.ts packages/shared/src/project-config.ts packages/shared/src/__tests__/project-config.test.ts
git commit -m "feat(config): global telegram.notify schema + resolveNotify (built-in→global→project)"
```

---

### Task 3: Crew tier → event-type mapping (core)

**Files:**
- Create: `packages/core/src/telegram/tiers.ts`
- Test: `packages/core/src/telegram/__tests__/tiers.test.ts`

**Interfaces:**
- Produces: `tierIncludes(tier: CrewTier, eventType: string): boolean`.
- Tier sets (cumulative): `done_only = {task.done, task.failed}`; `alert_only = done_only ∪ {task.blocked, task.approval.requested, task.input.requested, task.timeout}`; `all` = everything; `none` = nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { tierIncludes } from "../tiers.js";

describe("tierIncludes", () => {
  it("none lets nothing through", () => {
    expect(tierIncludes("none", "task.done")).toBe(false);
    expect(tierIncludes("none", "task.blocked")).toBe(false);
  });
  it("done_only = terminal outcomes only", () => {
    expect(tierIncludes("done_only", "task.done")).toBe(true);
    expect(tierIncludes("done_only", "task.failed")).toBe(true);
    expect(tierIncludes("done_only", "task.blocked")).toBe(false);
    expect(tierIncludes("done_only", "task.progress")).toBe(false);
  });
  it("alert_only adds the needs-you events, still drops noise", () => {
    expect(tierIncludes("alert_only", "task.blocked")).toBe(true);
    expect(tierIncludes("alert_only", "task.approval.requested")).toBe(true);
    expect(tierIncludes("alert_only", "task.input.requested")).toBe(true);
    expect(tierIncludes("alert_only", "task.timeout")).toBe(true);
    expect(tierIncludes("alert_only", "task.done")).toBe(true);
    expect(tierIncludes("alert_only", "task.progress")).toBe(false);
    expect(tierIncludes("alert_only", "task.idle")).toBe(false);
  });
  it("all lets everything through", () => {
    expect(tierIncludes("all", "task.progress")).toBe(true);
    expect(tierIncludes("all", "heartbeat")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/tiers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/telegram/tiers.ts
import type { CrewTier } from "@squadrant/shared";

const DONE_ONLY = new Set(["task.done", "task.failed"]);
const ALERTS = new Set([
  ...DONE_ONLY,
  "task.blocked",
  "task.approval.requested",
  "task.input.requested",
  "task.timeout",
]);

export function tierIncludes(tier: CrewTier, eventType: string): boolean {
  switch (tier) {
    case "none": return false;
    case "done_only": return DONE_ONLY.has(eventType);
    case "alert_only": return ALERTS.has(eventType);
    case "all": return true;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/tiers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Build + commit**

```bash
pnpm build
git add packages/core/src/telegram/tiers.ts packages/core/src/telegram/__tests__/tiers.test.ts
git commit -m "feat(telegram): crew tier → event-type mapping (tierIncludes)"
```

---

### Task 4: deliverOutbound — config-default active + crew filter (core)

**Files:**
- Modify: `packages/core/src/telegram/bridge.ts:52-61` (`deliverOutbound`)
- Test: `packages/core/src/telegram/__tests__/bridge.notify.test.ts` (create)

**Interfaces:**
- Consumes: `resolveNotify`, `loadProjectOverride` (shared), `tierIncludes` (Task 3), existing `loadState`.
- Behavior: `active = state.notify[project] ?? resolved.active` (live state wins; absent ⇒ config default). If `!active` → return. Else if `!tierIncludes(resolved.crew, ev.type)` → return. Else existing topic-create + send. Project override read via `loadProjectOverride(project, stateRoot's config root)`. Use `cfg.notify` for the global layer.

> Note: `loadProjectOverride` defaults its root to `~/.config/squadrant`; the bridge already uses `stateRoot` for state. Pass the config root explicitly. Add a `configRoot?: string` to `TelegramBridgeOptions` (defaults to `~/.config/squadrant`) so tests can point both at a temp dir. Thread it from `squadrantd.ts` (omit ⇒ default).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelegramBridge } from "../bridge.js";
import { saveProjectOverride } from "@squadrant/shared";
import { setNotify } from "../state.js";

function harness(root: string, globalNotify?: any) {
  const sent: string[] = [];
  const client = {
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(async (_c: number, _t: number | undefined, text: string) => { sent.push(text); }),
    createForumTopic: vi.fn(async () => 111),
    getMe: vi.fn(async () => ({ id: 1, username: "bot" })),
  };
  const bridge = createTelegramBridge({
    cfg: { supergroupId: -100, chats: [], notify: globalNotify } as any,
    stateRoot: root, configRoot: root, client: client as any,
    appendCaptainMessage: vi.fn(), log: vi.fn(),
  });
  return { bridge, sent, client };
}

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "sq-br-")); });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("deliverOutbound notify resolution", () => {
  it("drops everything when muted (default, absent state)", async () => {
    const { bridge, sent } = harness(root);
    bridge.pushLifecycle("p", { type: "task.done", id: "t1", resultRef: "r" } as any);
    await flush();
    expect(sent).toEqual([]);
  });

  it("alert_only drops task.done but sends task.blocked when active", async () => {
    setNotify(root, "p", true); // live unmute
    const { bridge, sent } = harness(root); // global default crew=alert_only
    bridge.pushLifecycle("p", { type: "task.done", id: "t1", resultRef: "r" } as any);
    bridge.pushLifecycle("p", { type: "task.blocked", id: "t2", reason: "x", question: "q" } as any);
    await flush();
    expect(sent.some((t) => t.includes("CREW DONE"))).toBe(false);
    expect(sent.some((t) => t.includes("BLOCKED"))).toBe(true);
  });

  it("project crew=all sends progress when active", async () => {
    setNotify(root, "p", true);
    saveProjectOverride("p", { telegram: { notify: { crew: "all" } } }, root);
    const { bridge, sent } = harness(root);
    bridge.pushLifecycle("p", { type: "task.progress", id: "t1", note: "n" } as any);
    await flush();
    expect(sent.length).toBe(1);
  });

  it("config-default active=true sends with absent live state", async () => {
    saveProjectOverride("p", { telegram: { notify: { active: true } } }, root);
    const { bridge, sent } = harness(root);
    bridge.pushLifecycle("p", { type: "task.done", id: "t1", resultRef: "r" } as any);
    // crew default alert_only includes task.done
    await flush();
    expect(sent.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/bridge.notify.test.ts`
Expected: FAIL — current `deliverOutbound` ignores tiers/config-default (e.g. the muted-default and config-default-active cases fail).

- [ ] **Step 3: Implement**

In `bridge.ts`, add to `TelegramBridgeOptions`:
```ts
  /** Root for per-project override files. Defaults to ~/.config/squadrant. */
  configRoot?: string;
```
Add imports:
```ts
import os from "node:os";
import path from "node:path";
import { resolveNotify, loadProjectOverride } from "@squadrant/shared";
import { tierIncludes } from "./tiers.js";
```
In the factory, after destructuring opts:
```ts
const configRoot = opts.configRoot ?? path.join(os.homedir(), ".config", "squadrant");
```
Replace `deliverOutbound`:
```ts
  async function deliverOutbound(project: string, ev: ControlEvent): Promise<void> {
    const resolved = resolveNotify(cfg.notify, loadProjectOverride(project, configRoot));
    const live = loadState(stateRoot).notify[project]; // boolean | undefined
    const active = live ?? resolved.active;
    if (!active) return;                                   // muted → no topic create, no send
    if (!tierIncludes(resolved.crew, ev.type)) return;     // tier filter
    let threadId = loadState(stateRoot).topics[topicKey(project)];
    if (threadId === undefined) {
      threadId = await client.createForumTopic(cfg.supergroupId, topicName(project));
      setTopic(stateRoot, project, threadId);
    }
    await client.sendMessage(cfg.supergroupId, threadId, formatLifecycle(project, ev));
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/bridge.notify.test.ts`
Expected: PASS (4 tests). Also run the existing bridge tests: `pnpm exec vitest run packages/core/src/telegram` → all green.

- [ ] **Step 5: Build + commit**

```bash
pnpm build
git add packages/core/src/telegram/bridge.ts packages/core/src/telegram/__tests__/bridge.notify.test.ts
git commit -m "feat(telegram): resolve notify active (config default + live state) and crew-tier filter in deliverOutbound"
```

---

### Task 5: format `failed` / `approval` / `input` / `timeout` (core)

**Files:**
- Modify: `packages/core/src/telegram/format.ts:10-21` (`formatLifecycle`)
- Test: `packages/core/src/telegram/__tests__/format.test.ts` (create or extend)

**Interfaces:**
- Consumes: `ControlEvent` variants from `@squadrant/shared` (`task.failed.error`, `task.approval.requested.question`, `task.input.requested.question`, `task.timeout.taskTimeoutMs`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { formatLifecycle } from "../format.js";

describe("formatLifecycle new cases", () => {
  it("failed shows the error", () => {
    const s = formatLifecycle("p", { type: "task.failed", id: "t1", error: "boom" } as any);
    expect(s).toContain("CREW FAILED");
    expect(s).toContain("boom");
  });
  it("approval shows the question", () => {
    const s = formatLifecycle("p", { type: "task.approval.requested", id: "t1", requestId: 1, question: "run rm?", kind: "shell" } as any);
    expect(s).toContain("APPROVAL");
    expect(s).toContain("run rm?");
  });
  it("input shows the question", () => {
    const s = formatLifecycle("p", { type: "task.input.requested", id: "t1", requestId: 1, question: "which env?" } as any);
    expect(s).toContain("INPUT");
    expect(s).toContain("which env?");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/format.test.ts`
Expected: FAIL — these fall to the generic `ℹ️` default, no `CREW FAILED`/`APPROVAL`/`INPUT`.

- [ ] **Step 3: Implement** (insert cases before `default:` in `formatLifecycle`)

```ts
    case "task.failed":
      return `❌ [${project}] CREW FAILED · ${ev.id}\n${ev.error}`;
    case "task.approval.requested":
      return `🔐 [${project}] APPROVAL NEEDED · ${ev.id}\n${ev.question}`;
    case "task.input.requested":
      return `❓ [${project}] INPUT NEEDED · ${ev.id}\n${ev.question}`;
    case "task.timeout":
      return `⏱️ [${project}] CREW TIMEOUT · ${ev.id}`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
pnpm build
git add packages/core/src/telegram/format.ts packages/core/src/telegram/__tests__/format.test.ts
git commit -m "feat(telegram): distinct formatting for failed/approval/input/timeout events"
```

---

### Task 6: CLI `telegram notify <project> crew|cap …` writes the override file

**Files:**
- Modify: `packages/cli/src/commands/telegram.ts:257-282` (`notify` subcommand)
- Test: `packages/cli/src/commands/__tests__/telegram.notify.test.ts` (create)

**Interfaces:**
- Consumes: `saveProjectOverride`, `loadProjectOverride` (shared).
- New grammar (keep the existing `on|off` → live state path unchanged):
  - `notify <project> crew <all|alert_only|done_only|none>` → `saveProjectOverride(project, { telegram: { notify: { crew } } })`
  - `notify <project> cap <on|off>` → `saveProjectOverride(project, { telegram: { notify: { cap: on } } })`

- [ ] **Step 1: Write the failing test** (test the pure helper, not the commander wiring)

First extract a pure helper in `telegram.ts`:
```ts
export function runTelegramNotifyPref(
  args: { project: string; dimension: "crew" | "cap"; value: string; root?: string },
): { ok: true } | { ok: false; message: string } {
  const { project, dimension, value, root } = args;
  if (dimension === "crew") {
    if (!["all", "alert_only", "done_only", "none"].includes(value))
      return { ok: false, message: "crew must be all|alert_only|done_only|none" };
    saveProjectOverride(project, { telegram: { notify: { crew: value as any } } }, root);
    return { ok: true };
  }
  if (value !== "on" && value !== "off") return { ok: false, message: "cap must be on|off" };
  saveProjectOverride(project, { telegram: { notify: { cap: value === "on" } } }, root);
  return { ok: true };
}
```
Test:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { loadProjectOverride } from "@squadrant/shared";
import { runTelegramNotifyPref } from "../telegram.js";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "sq-tn-")); });

describe("runTelegramNotifyPref", () => {
  it("writes crew tier to the override file", () => {
    expect(runTelegramNotifyPref({ project: "p", dimension: "crew", value: "all", root })).toEqual({ ok: true });
    expect(loadProjectOverride("p", root)).toEqual({ telegram: { notify: { crew: "all" } } });
  });
  it("rejects a bad crew tier", () => {
    expect(runTelegramNotifyPref({ project: "p", dimension: "crew", value: "loud", root }).ok).toBe(false);
  });
  it("writes cap on/off as boolean", () => {
    runTelegramNotifyPref({ project: "p", dimension: "cap", value: "off", root });
    expect(loadProjectOverride("p", root)).toEqual({ telegram: { notify: { cap: false } } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/cli/src/commands/__tests__/telegram.notify.test.ts`
Expected: FAIL — `runTelegramNotifyPref` not exported.

- [ ] **Step 3: Implement** the helper (above) and extend the `notify` action to dispatch:
- if `state` is `on`/`off` and no further arg → existing live-state path (unchanged).
- if `state` is `crew` or `cap` → read the 3rd positional arg as the value, call `runTelegramNotifyPref`, print result. Update the commander `.argument` list to accept a 3rd optional `[value]` and adjust the action signature accordingly. Keep the `--status` and `on|off` branches intact.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/cli/src/commands/__tests__/telegram.notify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Build + CLI smoke + commit**

```bash
pnpm build
node dist/index.js telegram notify --help   # must not crash (ESM .js gate)
git add packages/cli/src/commands/telegram.ts packages/cli/src/commands/__tests__/telegram.notify.test.ts
git commit -m "feat(cli): telegram notify <project> crew|cap writes per-project override"
```

---

### Task 7: `/notify` Telegram command writes the override file (core)

**Files:**
- Modify: `packages/core/src/telegram/bridge.ts` (extend in-topic command handling alongside `notifyToggle`)
- Test: `packages/core/src/telegram/__tests__/bridge.notifycmd.test.ts` (create)

**Interfaces:**
- Add a pure parser `parseNotifyPref(text): { dimension: "crew" | "cap"; value: string } | null` and, in `handleProjectTopic`, when it matches, call `saveProjectOverride(resolved.project, …, configRoot)` and `reply(threadId, confirmation)`. Fail-closed: only when `isControlEnabled(cfg) && isAuthorized(fromId, cfg)` (same gate as auto-launch). Unauthorized → `reply("⛔ not authorized")`. Must not throw into the poll loop.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseNotifyPref } from "../bridge.js";

describe("parseNotifyPref", () => {
  it("parses /notify crew all", () => {
    expect(parseNotifyPref("/notify crew all")).toEqual({ dimension: "crew", value: "all" });
  });
  it("parses /notify cap off", () => {
    expect(parseNotifyPref("/notify cap off")).toEqual({ dimension: "cap", value: "off" });
  });
  it("returns null for ordinary text", () => {
    expect(parseNotifyPref("please ship it")).toBeNull();
  });
  it("returns null for /notify with no dimension", () => {
    expect(parseNotifyPref("/notify")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/bridge.notifycmd.test.ts`
Expected: FAIL — `parseNotifyPref` not exported.

- [ ] **Step 3: Implement** — export the parser and wire it into `handleProjectTopic` (before the `appendCaptainMessage` line, after the existing `notifyToggle` block):
```ts
export function parseNotifyPref(text: string): { dimension: "crew" | "cap"; value: string } | null {
  const parts = text.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "/notify") return null;
  const dimension = parts[1]?.toLowerCase();
  if ((dimension === "crew" || dimension === "cap") && parts[2]) return { dimension, value: parts[2].toLowerCase() };
  return null;
}
```
In `handleProjectTopic`, reuse `saveProjectOverride` + the same validation as Task 6 (factor the validation into a shared check or inline it). On success reply `✅ ${dimension} = ${value}`; on invalid value reply the usage message. Gate behind `isControlEnabled(cfg) && isAuthorized(fromId, cfg)`; otherwise reply not-authorized and return (do not fall through to `appendCaptainMessage`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/core/src/telegram/__tests__/bridge.notifycmd.test.ts`
Expected: PASS (4 tests). Re-run the whole telegram suite: `pnpm exec vitest run packages/core/src/telegram` → green.

- [ ] **Step 5: Build + commit**

```bash
pnpm build
git add packages/core/src/telegram/bridge.ts packages/core/src/telegram/__tests__/bridge.notifycmd.test.ts
git commit -m "feat(telegram): /notify crew|cap command writes per-project override (fail-closed)"
```

---

### Task 8: `cap` gate on `squadrant telegram send` (cli)

**Files:**
- Modify: `packages/cli/src/commands/telegram.ts:284-…` (`send` action)
- Test: `packages/cli/src/commands/__tests__/telegram.send.test.ts` (create)

**Interfaces:**
- Consumes: `resolveNotify`, `loadProjectOverride` (shared). Extract a pure predicate `capAllowed(project, globalNotify, root): boolean = resolveNotify(globalNotify, loadProjectOverride(project, root)).cap` and (optionally) gate on `active` too. For v0.11.0 scope: gate on `cap` only (an explicit captain push shouldn't be silently dropped just because the topic is idle-muted; `cap=false` is the deliberate "don't let the captain DM me" switch).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { saveProjectOverride } from "@squadrant/shared";
import { capAllowed } from "../telegram.js";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "sq-ts-")); });

describe("capAllowed", () => {
  it("defaults to true (built-in cap=true)", () => {
    expect(capAllowed("p", undefined, root)).toBe(true);
  });
  it("project cap=false suppresses captain sends", () => {
    saveProjectOverride("p", { telegram: { notify: { cap: false } } }, root);
    expect(capAllowed("p", undefined, root)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/cli/src/commands/__tests__/telegram.send.test.ts`
Expected: FAIL — `capAllowed` not exported.

- [ ] **Step 3: Implement** `capAllowed` and call it in the `send` action: after resolving token, if `!capAllowed(project, cfg.notify, undefined)` print `chalk.dim(\`${project}: captain messages muted (cap=off) — not sent\`)` and `return` before `client.sendMessage`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run packages/cli/src/commands/__tests__/telegram.send.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Build + full gate + commit**

```bash
pnpm build
node dist/index.js telegram send --help
pnpm test   # full suite green (run once, clean)
git add packages/cli/src/commands/telegram.ts packages/cli/src/commands/__tests__/telegram.send.test.ts
git commit -m "feat(cli): gate telegram send on resolved cap (per-project)"
```

---

## Documentation (fold into the final task's commit or a follow-up)

- Update the telegram README/section to document: per-project config file location, `crew` tiers + their event sets, `cap`, the config-default-vs-live-mute distinction, and the new CLI/`/notify` grammar.
- Note in CHANGELOG under the v0.11.0 entry.

## Self-Review notes (already reconciled)

- **Spec coverage:** file layout (Task 1), resolver/precedence (Tasks 1–2, 4), config-vs-state split (Task 4 active resolution; Tasks 6–7 write config, `/mute` untouched), crew tiers (Task 3), cap (Task 8), CLI + TG surfaces (Tasks 6–8), migration/additivity (Global Constraints + Task 4 default path). Future tenants (effort/models) reserved in `ProjectOverrideConfig` (Task 1), not wired — matches spec scope.
- **Type consistency:** `NotifyConfig`/`CrewTier`/`ProjectOverrideConfig` defined once in shared (Task 1–2), imported everywhere; `tierIncludes`/`resolveNotify`/`saveProjectOverride`/`loadProjectOverride` names used identically across tasks.
- **Decisions:** project-overrides-global and `done_only = {done, failed}` applied in Tasks 2 and 3. Flag to user before merge if either flips (both are one-line edits).
