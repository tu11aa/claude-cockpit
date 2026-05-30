// src/control/__tests__/cockpitd-push.test.ts
//
// Phase 3.5 (#109): daemon-side push notifications to captain on terminal
// task events. Tests the daemon.ts injection point with a fake `notify`
// dep — no real cmux, no real config, just the trigger logic.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemon } from "../daemon.js";
import { createStore } from "../store.js";
import type { TaskRecord, ControlEvent } from "../types.js";

function rec(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id, project: "p", provider: "claude", mode: "interactive",
    state: "working", task: "build the foo widget", createdAt: 1, lastHeartbeat: 1,
    lastEvent: "", heartbeatBudgetMs: 1000,
    attempts: [{ attemptId: "a0", startedAt: 1, lastHeartbeatAt: 1 }],
    ...overrides,
  };
}

interface NotifyCall {
  project: string;
  message: string;
}

function fakeNotify() {
  const calls: NotifyCall[] = [];
  return {
    calls,
    notify: (args: { project: string; message: string; record: TaskRecord; event: ControlEvent }) => {
      calls.push({ project: args.project, message: args.message });
    },
  };
}

describe("cockpitd push notifications (#109)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cp-push-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("done event triggers exactly one notify with CREW DONE prefix", async () => {
    const store = createStore(dir);
    store.put(rec("task-12345678", { task: "ship the widget" }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 2000, notify: n.notify });
    await d.handle({
      kind: "event",
      project: "p",
      event: { type: "task.done", id: "task-12345678", resultRef: "/tmp/missing-file-on-purpose" },
    });
    expect(n.calls).toHaveLength(1);
    expect(n.calls[0]?.project).toBe("p");
    expect(n.calls[0]?.message).toMatch(/^CREW DONE \[claude\/task-123/);
  });

  it("blocked event triggers CREW BLOCKED with the question", async () => {
    const store = createStore(dir);
    store.put(rec("task-blocked-1"));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 2000, notify: n.notify });
    await d.handle({
      kind: "event",
      project: "p",
      event: { type: "task.blocked", id: "task-blocked-1", reason: "need-input", question: "which db?" },
    });
    expect(n.calls).toHaveLength(1);
    expect(n.calls[0]?.message).toMatch(/^CREW BLOCKED \[claude\/task-blo/);
    expect(n.calls[0]?.message).toContain("which db?");
  });

  it("failed event triggers CREW FAILED with the error", async () => {
    const store = createStore(dir);
    store.put(rec("task-failed-1"));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 2000, notify: n.notify });
    await d.handle({
      kind: "event",
      project: "p",
      event: { type: "task.failed", id: "task-failed-1", error: "boom: subprocess crashed" },
    });
    expect(n.calls).toHaveLength(1);
    expect(n.calls[0]?.message).toMatch(/^CREW FAILED \[claude\/task-fai/);
    expect(n.calls[0]?.message).toContain("boom: subprocess crashed");
  });

  it("HEADLESS stall (from sweep) triggers CREW STALLED with budget", async () => {
    const store = createStore(dir);
    store.put(rec("task-stall-1", { mode: "headless", state: "working", lastHeartbeat: 0, heartbeatBudgetMs: 250 }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 5000, notify: n.notify });
    d.sweep();
    expect(store.get("p", "task-stall-1")?.state).toBe("stalled");
    expect(n.calls).toHaveLength(1);
    expect(n.calls[0]?.message).toMatch(/^CREW STALLED \[claude\/task-sta/);
    expect(n.calls[0]?.message).toMatch(/no heartbeat/i);
  });

  it("INTERACTIVE idle (from sweep) triggers exactly one CREW IDLE notify", async () => {
    const store = createStore(dir);
    // rec() defaults to mode: "interactive"
    store.put(rec("task-idle-1", { state: "working", lastHeartbeat: 0, heartbeatBudgetMs: 250 }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 5000, notify: n.notify });
    d.sweep();
    expect(store.get("p", "task-idle-1")?.state).toBe("awaiting-input");
    expect(n.calls).toHaveLength(1);
    expect(n.calls[0]?.message).toMatch(/^CREW IDLE \[claude\/task-idl/);
    expect(n.calls[0]?.message).not.toMatch(/stall/i); // reads as idle, not failure
    expect(n.calls[0]?.message).toMatch(/awaiting your input/i);
  });

  it("awaiting-input sits idle across repeated sweeps → no notification storm", async () => {
    const store = createStore(dir);
    store.put(rec("task-idle-2", { state: "working", lastHeartbeat: 0, heartbeatBudgetMs: 250 }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 5000, notify: n.notify });
    d.sweep(); // working → awaiting-input, one push
    d.sweep(); // awaiting-input is not 'working' → no re-stall, no re-notify
    d.sweep();
    expect(store.get("p", "task-idle-2")?.state).toBe("awaiting-input");
    expect(n.calls).toHaveLength(1);
  });

  it("awaiting-input + task.started (captain resumes) → working, no extra notify", async () => {
    const store = createStore(dir);
    store.put(rec("task-idle-3", { state: "working", lastHeartbeat: 0, heartbeatBudgetMs: 250 }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 5000, notify: n.notify });
    d.sweep(); // → awaiting-input, push #1 (CREW IDLE)
    await d.handle({ kind: "event", project: "p", event: { type: "task.started", id: "task-idle-3" } });
    expect(store.get("p", "task-idle-3")?.state).toBe("working");
    expect(n.calls).toHaveLength(1); // working is not an attention state → no extra push
  });

  it("redundant terminal event does NOT re-notify (state-change guard)", async () => {
    const store = createStore(dir);
    // Already done — state machine ignores further events idempotently.
    store.put(rec("task-done-already", { state: "done" }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 2000, notify: n.notify });
    await d.handle({
      kind: "event",
      project: "p",
      event: { type: "task.done", id: "task-done-already", resultRef: "/tmp/x" },
    });
    expect(n.calls).toHaveLength(0);
  });

  it("liveness events (progress/heartbeat) do NOT notify", async () => {
    const store = createStore(dir);
    store.put(rec("task-live-1", { state: "working" }));
    const n = fakeNotify();
    const d = createDaemon({ store, now: () => 2000, notify: n.notify });
    await d.handle({
      kind: "event",
      project: "p",
      event: { type: "task.progress", id: "task-live-1" },
    });
    await d.handle({
      kind: "event",
      project: "p",
      event: { type: "heartbeat", id: "task-live-1" },
    });
    expect(n.calls).toHaveLength(0);
  });

  it("notifier throwing does NOT crash the daemon; event still applies", async () => {
    const store = createStore(dir);
    store.put(rec("task-bang-1"));
    const throwingNotify = () => { throw new Error("cmux is down"); };
    const d = createDaemon({ store, now: () => 2000, notify: throwingNotify });
    // The handle call must NOT reject.
    const r = await d.handle({
      kind: "event",
      project: "p",
      event: { type: "task.done", id: "task-bang-1", resultRef: "/tmp/x" },
    });
    expect((r as TaskRecord).state).toBe("done");
    // And the store still reflects the new state.
    expect(store.get("p", "task-bang-1")?.state).toBe("done");
  });
});

// ── Issue #185: CREW IDLE debounce ──────────────────────────────────────────
// New contract: task.turn.completed → awaiting-input is SILENT. The sweep
// fires CREW IDLE exactly ONCE after IDLE_NOTIFY_MS (120 s) of inactivity.
describe("daemon – idle debounce (#185)", () => {
  const IDLE_NOTIFY_MS = 120_000; // must match daemon.ts constant

  let dir2: string;
  beforeEach(() => { dir2 = mkdtempSync(join(tmpdir(), "cp-deb-")); });
  afterEach(() => rmSync(dir2, { recursive: true, force: true }));

  it("task.turn.completed → awaiting-input fires NO notify (silent turn-end)", async () => {
    const store = createStore(dir2);
    store.put(rec("t-turn-end", { state: "working" }));
    const calls: NotifyCall[] = [];
    const d = createDaemon({
      store, now: () => 2000,
      notify: (a) => { calls.push({ project: a.project, message: a.message }); },
    });
    await d.handle({ kind: "event", project: "p", event: { type: "task.turn.completed", id: "t-turn-end", turnId: "hook-stop" } });
    expect(store.get("p", "t-turn-end")?.state).toBe("awaiting-input"); // state still transitions
    expect(calls).toHaveLength(0); // CREW IDLE held by debounce
  });

  it("sweep idle-notify: awaiting-input past IDLE_NOTIFY_MS fires CREW IDLE exactly once", async () => {
    const store = createStore(dir2);
    store.put(rec("t-deb-fire", { state: "awaiting-input", lastHeartbeat: 0 }));
    const calls: NotifyCall[] = [];
    const d = createDaemon({
      store, now: () => IDLE_NOTIFY_MS + 1000,
      notify: (a) => { calls.push({ project: a.project, message: a.message }); },
    });
    d.sweep();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.message).toMatch(/^CREW IDLE/);
    expect(calls[0]?.message).toMatch(/awaiting your input/i);
    expect(store.get("p", "t-deb-fire")?.idleNotified).toBe(true);
  });

  it("sweep idle-notify: second sweep does NOT re-fire (idleNotified guard)", async () => {
    const store = createStore(dir2);
    store.put(rec("t-deb-once", { state: "awaiting-input", lastHeartbeat: 0 }));
    const calls: NotifyCall[] = [];
    const d = createDaemon({
      store, now: () => IDLE_NOTIFY_MS + 1000,
      notify: (a) => { calls.push({ project: a.project, message: a.message }); },
    });
    d.sweep(); // fires CREW IDLE, sets idleNotified=true
    d.sweep(); // idleNotified guard → no re-fire
    d.sweep();
    expect(calls).toHaveLength(1);
  });

  it("sweep idle-notify: fresh awaiting-input task within IDLE_NOTIFY_MS → no notify yet", async () => {
    const store = createStore(dir2);
    // now - lastHeartbeat = 5000 < 120000 → debounce not expired
    store.put(rec("t-deb-fresh", { state: "awaiting-input", lastHeartbeat: 0 }));
    const calls: NotifyCall[] = [];
    const d = createDaemon({
      store, now: () => 5000,
      notify: (a) => { calls.push({ project: a.project, message: a.message }); },
    });
    d.sweep();
    expect(calls).toHaveLength(0);
  });

  it("returning to working clears idleNotified so next idle period can re-notify", async () => {
    const store = createStore(dir2);
    store.put(rec("t-deb-reset", { state: "awaiting-input", lastHeartbeat: 0, idleNotified: true }));
    const d = createDaemon({ store, now: () => 2000 });
    // task.progress from awaiting-input → working must clear idleNotified
    await d.handle({ kind: "event", project: "p", event: { type: "task.progress", id: "t-deb-reset" } });
    const after = store.get("p", "t-deb-reset");
    expect(after?.state).toBe("working");
    expect(after?.idleNotified).toBeFalsy();
  });
});
