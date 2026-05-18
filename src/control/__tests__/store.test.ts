// src/control/__tests__/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../store.js";
import type { TaskRecord } from "../types.js";

function rec(id: string): TaskRecord {
  return {
    id, project: "proj", provider: "claude", mode: "headless",
    state: "submitted", task: "t", createdAt: 1, lastHeartbeat: 1,
    lastEvent: "", heartbeatBudgetMs: 1000,
  };
}

describe("store", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cp-store-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("put then get round-trips a record", () => {
    const s = createStore(dir);
    s.put(rec("t1"));
    expect(s.get("proj", "t1")?.state).toBe("submitted");
  });

  it("get returns undefined for missing task", () => {
    const s = createStore(dir);
    expect(s.get("proj", "nope")).toBeUndefined();
  });

  it("list returns all records for a project", () => {
    const s = createStore(dir);
    s.put(rec("t1")); s.put(rec("t2"));
    expect(s.list("proj").map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });
});
