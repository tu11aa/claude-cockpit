// packages/core/src/__tests__/lifecycle-source.test.ts
//
// Table-driven unit tests for the pure `reduceLifecycle` reducer.
// These cover every transition rule from the FeedCoordinator spec (D1-D7):
//   - agent-originated signals are authoritative
//   - scan may NEVER assert needsInput
//   - needsInput set by an agent only relaxes on an agent-originated running
//   - a stale scan does not regress a more recent agent state
import { describe, it, expect } from "vitest";
import { reduceLifecycle } from "../lifecycle-source.js";
import type { LifecycleSnapshot, LifecycleState } from "../lifecycle-source.js";

// ── helpers ─────────────────────────────────────────────────────────────────

function snap(
  state: LifecycleState,
  origin: "agent" | "scan",
  at = 100,
  taskId = "t1",
): LifecycleSnapshot {
  return { taskId, state, alive: true, origin, at };
}

// ── table cases ─────────────────────────────────────────────────────────────

// Case set 1: no prior state + agent signal — agent is authoritative.
describe("reduceLifecycle — no prior + agent", () => {
  it("undefined prev + agent running → running", () => {
    expect(reduceLifecycle(undefined, snap("running", "agent"))).toBe("running");
  });
  it("undefined prev + agent idle → idle", () => {
    expect(reduceLifecycle(undefined, snap("idle", "agent"))).toBe("idle");
  });
  it("undefined prev + agent needsInput → needsInput", () => {
    expect(reduceLifecycle(undefined, snap("needsInput", "agent"))).toBe("needsInput");
  });
  it("undefined prev + agent unknown → unknown", () => {
    expect(reduceLifecycle(undefined, snap("unknown", "agent"))).toBe("unknown");
  });
});

// Case set 2: no prior state + scan signal — scan provides liveness only.
describe("reduceLifecycle — no prior + scan", () => {
  it("undefined prev + scan running → running", () => {
    expect(reduceLifecycle(undefined, snap("running", "scan"))).toBe("running");
  });
  it("undefined prev + scan idle → idle", () => {
    expect(reduceLifecycle(undefined, snap("idle", "scan"))).toBe("idle");
  });
  it("undefined prev + scan unknown → unknown", () => {
    expect(reduceLifecycle(undefined, snap("unknown", "scan"))).toBe("unknown");
  });
  it("undefined prev + scan needsInput → unknown (scan cannot assert needsInput)", () => {
    expect(reduceLifecycle(undefined, snap("needsInput", "scan"))).toBe("unknown");
  });
});

// Case set 3: agent-set needsInput is sticky — scan cannot override it.
describe("reduceLifecycle — needsInput sticky against scans", () => {
  const prev = snap("needsInput", "agent", 10);

  it("agent needsInput + scan running (newer) → needsInput", () => {
    expect(reduceLifecycle(prev, snap("running", "scan", 20))).toBe("needsInput");
  });
  it("agent needsInput + scan idle (newer) → needsInput", () => {
    expect(reduceLifecycle(prev, snap("idle", "scan", 20))).toBe("needsInput");
  });
  it("agent needsInput + scan unknown (newer) → needsInput", () => {
    expect(reduceLifecycle(prev, snap("unknown", "scan", 20))).toBe("needsInput");
  });
  it("agent needsInput + scan needsInput (newer) → needsInput (invalid scan state preserved via stickiness)", () => {
    expect(reduceLifecycle(prev, snap("needsInput", "scan", 20))).toBe("needsInput");
  });
});

// Case set 4: agent CAN override any prior state including needsInput.
describe("reduceLifecycle — agent overrides everything", () => {
  it("agent needsInput prev + agent running → running", () => {
    expect(reduceLifecycle(snap("needsInput", "agent", 10), snap("running", "agent", 20))).toBe("running");
  });
  it("agent needsInput prev + agent idle → idle", () => {
    expect(reduceLifecycle(snap("needsInput", "agent", 10), snap("idle", "agent", 20))).toBe("idle");
  });
  it("agent needsInput prev + agent unknown → unknown", () => {
    expect(reduceLifecycle(snap("needsInput", "agent", 10), snap("unknown", "agent", 20))).toBe("unknown");
  });
  it("scan idle prev + agent needsInput → needsInput", () => {
    expect(reduceLifecycle(snap("idle", "scan", 10), snap("needsInput", "agent", 20))).toBe("needsInput");
  });
  it("agent running prev + agent needsInput → needsInput", () => {
    expect(reduceLifecycle(snap("running", "agent", 10), snap("needsInput", "agent", 20))).toBe("needsInput");
  });
});

// Case set 5: stale scan does not regress a more-recent agent state.
describe("reduceLifecycle — timestamp precedence for scans", () => {
  it("agent running (at=20) + scan idle (at=10, stale) → running", () => {
    expect(reduceLifecycle(snap("running", "agent", 20), snap("idle", "scan", 10))).toBe("running");
  });
  it("agent running (at=10) + scan idle (at=20, newer) → idle", () => {
    expect(reduceLifecycle(snap("running", "agent", 10), snap("idle", "scan", 20))).toBe("idle");
  });
  it("agent running (at=20) + scan unknown (at=20, same timestamp) → running (tie → agent wins)", () => {
    expect(reduceLifecycle(snap("running", "agent", 20), snap("unknown", "scan", 20))).toBe("running");
  });
});

// Case set 6: scan prev + agent next — agent is always authoritative regardless of timestamp.
describe("reduceLifecycle — agent always wins against scan prev", () => {
  it("scan idle (at=20) prev + agent running (at=10, older) → running", () => {
    expect(reduceLifecycle(snap("idle", "scan", 20), snap("running", "agent", 10))).toBe("running");
  });
  it("scan running (at=100) prev + agent needsInput (at=1) → needsInput", () => {
    expect(reduceLifecycle(snap("running", "scan", 100), snap("needsInput", "agent", 1))).toBe("needsInput");
  });
});
