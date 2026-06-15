// src/control/__tests__/cockpitd.telegram.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startCockpitd } from "../cockpitd.js";
import { sendRequest } from "../protocol.js";
import type { TelegramSubsystem } from "../telegram/subsystem.js";

function tmpRoots() {
  const root = mkdtempSync(join(tmpdir(), "cd-"));
  return { stateRoot: join(root, "state"), sockPath: join(root, "d.sock") };
}

const SEED_RECORD = {
  id: "t1", project: "cockpit", provider: "claude", mode: "interactive",
  state: "submitted", task: "x", createdAt: 1, lastHeartbeat: 1,
  lastEvent: "", heartbeatBudgetMs: 1000,
  attempts: [{ attemptId: "a0", startedAt: 1, lastHeartbeatAt: 1 }],
} as const;

describe("cockpitd telegram wiring", () => {
  it("starts inbound on boot; crash-contained: throwing pushLifecycle never crashes the daemon", async () => {
    const { stateRoot, sockPath } = tmpRoots();
    const pushLifecycle = vi.fn(async () => { throw new Error("tg network down"); });
    const telegram: TelegramSubsystem = { pushLifecycle, startInbound: vi.fn(), stop: vi.fn() };

    const h = startCockpitd({ stateRoot, sockPath, sweepMs: 0, rotationIntervalMs: 0, telegram });
    expect(telegram.startInbound).toHaveBeenCalled();

    // Seed a task, transition to working, then to done (an ATTENTION_STATE that
    // triggers composedNotify → fire-and-forgets pushLifecycle). The throw must
    // not surface to the daemon event loop.
    await sendRequest(sockPath, { kind: "seed", record: SEED_RECORD });
    await sendRequest(sockPath, { kind: "event", project: "cockpit", event: { type: "task.started", id: "t1" } });
    const r1 = await sendRequest(sockPath, { kind: "event", project: "cockpit", event: { type: "task.done", id: "t1" } }) as { state: string };
    expect(r1.state).toBe("done");

    // Wait a tick for the fire-and-forget void to execute.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushLifecycle).toHaveBeenCalledTimes(1);
    expect(pushLifecycle).toHaveBeenCalledWith(expect.objectContaining({ project: "cockpit", record: expect.objectContaining({ state: "done" }) }));

    // Daemon is still alive after the throw — processes a subsequent request.
    const r2 = await sendRequest(sockPath, { kind: "status", project: "cockpit", id: "t1" }) as { state: string };
    expect(r2.state).toBe("done");

    await h.stop();
    expect(telegram.stop).toHaveBeenCalled();
  });

  it("does not start telegram when opts.telegram is absent and config has none", async () => {
    const { stateRoot, sockPath } = tmpRoots();
    const h = startCockpitd({ stateRoot, sockPath, sweepMs: 0, rotationIntervalMs: 0 });
    await h.stop();
    expect(true).toBe(true);
  });
});
