// src/control/__tests__/watchdog.test.ts
import { describe, it, expect } from "vitest";
import { evaluateStall } from "../watchdog.js";
import type { TaskRecord } from "../types.js";

function rec(o: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "t1", project: "p", provider: "claude", mode: "headless",
    state: "working", task: "t", createdAt: 0, lastHeartbeat: 1000,
    lastEvent: "", heartbeatBudgetMs: 5000, ...o,
  };
}

describe("evaluateStall", () => {
  it("working past budget → stalled", () => {
    const out = evaluateStall(rec(), 6001);
    expect(out?.state).toBe("stalled");
  });

  it("working within budget → no change (null)", () => {
    expect(evaluateStall(rec(), 5999)).toBeNull();
  });

  it("non-working state is never stalled", () => {
    expect(evaluateStall(rec({ state: "blocked" }), 999999)).toBeNull();
    expect(evaluateStall(rec({ state: "done" }), 999999)).toBeNull();
  });
});
