import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCockpitd, discoverCaptainSurface } from "../cockpitd.js";
import { appendToMailbox, writeCursor } from "../mailbox.js";
import type { DaemonCmux } from "../cmux/daemon-cmux.js";
import type { PaneRef } from "../../runtimes/types.js";
import type { TaskRecord, ControlEvent } from "../types.js";

const TASK: TaskRecord = {
  id: "t1", project: "p", provider: "claude", mode: "interactive",
  state: "submitted", task: "x", createdAt: 1, lastHeartbeat: 1,
  lastEvent: "", heartbeatBudgetMs: 1000,
  name: "test-crew",
  attempts: [{ attemptId: "a0", startedAt: 1, lastHeartbeatAt: 1 }],
};

const EVENT: ControlEvent = { type: "task.done", id: "t1", resultRef: "/tmp/x" };

function fakeCmux(): DaemonCmux & { sent: Array<{ text: string }> } {
  const sent: Array<{ text: string }> = [];
  return {
    sent,
    send: async (_surface: PaneRef, text: string) => { sent.push({ text }); },
    listSurfaces: async () => [],
    readScreen: async () => null,
    isAvailable: async () => true,
    findWorkspaceId: async () => null, // cmux workspaces not available in test
  } as unknown as DaemonCmux & { sent: Array<{ text: string }> };
}

describe("cockpitd daemon-direct (#332)", () => {
  let stop: (() => void) | undefined;
  let dir: string;
  afterEach(() => { stop?.(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("flag ON: daemon delivers queued captain messages via DaemonCmux + CaptainDelivery", async () => {
    dir = mkdtempSync(join(tmpdir(), "cp-dd-"));
    const sock = join(dir, "c.sock");
    const stateRoot = join(dir, "state");
    mkdirSync(join(stateRoot, "inbox"), { recursive: true });

    // Seed the mailbox directly.
    await appendToMailbox({ stateRoot, project: "p", taskRecord: TASK, event: EVENT, message: "CREW DONE [claude/t1] — build the widget" });
    // Write cursor for the "captain" subscriber starting at seq 0.
    await writeCursor({ stateRoot, project: "p", subscriber: "captain", lastAckedSeq: 0 });

    const cmux = fakeCmux();
    const handle = startCockpitd({
      stateRoot,
      sockPath: sock,
      sweepMs: 0,
      daemonCmux: cmux,
      daemonDirectCmux: true,
      captainSurfaces: { p: { workspaceId: "ws:1", surfaceId: "surface:1", title: "captain" } },
    });
    stop = handle.stop;

    if (handle.tickDelivery) await handle.tickDelivery();

    expect(cmux.sent.length).toBe(1);
    expect(cmux.sent[0].text).toMatch(/CREW DONE/);
  });

  it("discoverCaptainSurface finds the matching captain pane by title", () => {
    const surfaces: PaneRef[] = [
      { workspaceId: "ws:1", surfaceId: "s9", title: "⚓ cockpit-captain" },
      { workspaceId: "ws:1", surfaceId: "s10", title: "🔧 cockpit:crew-1" },
    ];
    expect(discoverCaptainSurface(surfaces, "⚓ cockpit-captain")?.surfaceId).toBe("s9");
    expect(discoverCaptainSurface(surfaces, "nonexistent")).toBeNull();
  });

  it("reaps the captain as closed after K consecutive sweeps with no captain surface", async () => {
    dir = mkdtempSync(join(tmpdir(), "cp-dd-reap-"));
    const sock = join(dir, "c.sock");
    const stateRoot = join(dir, "state");
    mkdirSync(join(stateRoot, "inbox"), { recursive: true });

    // Seed a message for delivery on the first tick. Also seed a store task so
    // project "p" appears in the delivery tick's project iteration.
    await appendToMailbox({ stateRoot, project: "p", taskRecord: TASK, event: EVENT, message: "CREW DONE" });
    await writeCursor({ stateRoot, project: "p", subscriber: "captain", lastAckedSeq: 0 });
    mkdirSync(join(stateRoot, "p"), { recursive: true });
    writeFileSync(join(stateRoot, "p", `${TASK.id}.json`), JSON.stringify(TASK));

    const captainTitle = "p-captain";
    // Mock: first tick → captain present; subsequent ticks → captain absent (gone)
    let surfCall = 0;
    const surfResults: PaneRef[][] = [
      [{ workspaceId: "ws:1", surfaceId: "s1", title: captainTitle }],    // tick 1: found
      [{ workspaceId: "ws:1", surfaceId: "s2", title: "some-other-pane" }], // tick 2: gone
      [{ workspaceId: "ws:1", surfaceId: "s2", title: "some-other-pane" }], // tick 3: gone
      [{ workspaceId: "ws:1", surfaceId: "s2", title: "some-other-pane" }], // tick 4: gone → reap
      [{ workspaceId: "ws:1", surfaceId: "s1", title: captainTitle }],      // tick 5: would resume but reaped
    ];
    const cmux = {
      sent: [] as Array<{ text: string }>,
      send: async (_surface: PaneRef, text: string) => { (cmux as any).sent.push({ text }); },
      listSurfaces: async () => surfResults[surfCall++],
      readScreen: async () => null,
      isAvailable: async () => true,
      findWorkspaceId: async (name: string) => name === captainTitle ? "ws:1" : null,
    } as unknown as DaemonCmux & { sent: Array<{ text: string }> };

    const handle = startCockpitd({
      stateRoot, sockPath: sock, sweepMs: 0,
      daemonCmux: cmux,
      daemonDirectCmux: true,
    });
    stop = handle.stop;

    // Tick 1: captain found → message delivered.
    if (handle.tickDelivery) await handle.tickDelivery();
    expect(cmux.sent.length).toBe(1);

    // Tick 2-4: captain gone → streak builds to K=3 → project reaped.
    if (handle.tickDelivery) await handle.tickDelivery(); // streak=1
    expect(cmux.sent.length).toBe(1);
    if (handle.tickDelivery) await handle.tickDelivery(); // streak=2
    expect(cmux.sent.length).toBe(1);
    if (handle.tickDelivery) await handle.tickDelivery(); // streak=3 → reaped
    expect(cmux.sent.length).toBe(1);

    // Tick 5: captain surface reappears but project is reaped → no delivery.
    if (handle.tickDelivery) await handle.tickDelivery();
    expect(cmux.sent.length).toBe(1);
  });

  it("does NOT reap on a single transient empty sweep (K>1)", async () => {
    dir = mkdtempSync(join(tmpdir(), "cp-dd-transient-"));
    const sock = join(dir, "c.sock");
    const stateRoot = join(dir, "state");
    mkdirSync(join(stateRoot, "inbox"), { recursive: true });

    await appendToMailbox({ stateRoot, project: "p", taskRecord: TASK, event: EVENT, message: "CREW DONE [claude/t1]" });
    await writeCursor({ stateRoot, project: "p", subscriber: "captain", lastAckedSeq: 0 });
    mkdirSync(join(stateRoot, "p"), { recursive: true });
    writeFileSync(join(stateRoot, "p", `${TASK.id}.json`), JSON.stringify(TASK));

    // Mock: first tick → gone (wrong title), second tick → captain found
    let callIdx = 0;
    const results: PaneRef[][] = [
      [{ workspaceId: "ws:1", surfaceId: "s2", title: "some-other-pane" }], // tick 1: gone
      [{ workspaceId: "ws:1", surfaceId: "s1", title: "p-captain" }], // tick 2: found
    ];
    const captainTitle = "p-captain";
    const cmux = {
      sent: [] as Array<{ text: string }>,
      send: async (_surface: PaneRef, text: string) => { (cmux as any).sent.push({ text }); },
      listSurfaces: async () => results[callIdx++],
      readScreen: async () => null,
      isAvailable: async () => true,
      findWorkspaceId: async (name: string) => name === captainTitle ? "ws:1" : null,
    } as unknown as DaemonCmux & { sent: Array<{ text: string }> };

    const handle = startCockpitd({
      stateRoot, sockPath: sock, sweepMs: 0,
      daemonCmux: cmux,
      daemonDirectCmux: true,
    });
    stop = handle.stop;

    // Tick 1: transient absence → streak=1, no delivery.
    if (handle.tickDelivery) await handle.tickDelivery();
    expect(cmux.sent.length).toBe(0);

    // Tick 2: captain found → message delivered, streak reset.
    if (handle.tickDelivery) await handle.tickDelivery();
    expect(cmux.sent.length).toBe(1);
  });

  it("flag OFF: daemon does NOT run the delivery loop (relay path owns it)", async () => {
    dir = mkdtempSync(join(tmpdir(), "cp-dd-off-"));
    const sock = join(dir, "c.sock");
    const stateRoot = join(dir, "state");
    mkdirSync(join(stateRoot, "inbox"), { recursive: true });

    await appendToMailbox({ stateRoot, project: "p", taskRecord: TASK, event: EVENT, message: "CREW DONE [claude/t1]" });
    await writeCursor({ stateRoot, project: "p", subscriber: "captain", lastAckedSeq: 0 });

    const cmux = fakeCmux();
    const handle = startCockpitd({
      stateRoot,
      sockPath: sock,
      sweepMs: 0,
      daemonCmux: cmux,
      daemonDirectCmux: false,
      captainSurfaces: { p: { workspaceId: "ws:1", surfaceId: "surface:1", title: "captain" } },
    });
    stop = handle.stop;

    expect((handle as any).tickDelivery).toBeUndefined();
    expect(cmux.sent).toEqual([]);
  });
});
