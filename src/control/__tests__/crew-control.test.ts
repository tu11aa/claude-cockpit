// src/control/__tests__/crew-control.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildDispatchRequest, buildStatusRequest } from "../../commands/crew-control.js";

describe("crew-control request builders", () => {
  it("dispatch request carries project/provider/mode/task and a generated id", () => {
    const r = buildDispatchRequest({ project: "p", provider: "codex", mode: "headless", task: "fix x" });
    expect(r.kind).toBe("dispatch");
    expect(r.record.project).toBe("p");
    expect(r.record.provider).toBe("codex");
    expect(r.record.mode).toBe("headless");
    expect(r.record.task).toBe("fix x");
    expect(r.record.state).toBe("submitted");
    expect(typeof r.record.id).toBe("string");
    expect(r.record.id.length).toBeGreaterThan(0);
  });

  it("status request targets a task id", () => {
    expect(buildStatusRequest("p", "t9")).toEqual({ kind: "status", project: "p", id: "t9" });
  });
});
