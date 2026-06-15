// src/control/telegram/__tests__/state.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTelegramState } from "../state.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "tg-"));
}

describe("telegram state", () => {
  it("starts empty and defaults offset to 0", async () => {
    const s = await loadTelegramState(freshRoot());
    expect(s.offset()).toBe(0);
    expect(s.getTopic("cockpit", "t1")).toBeUndefined();
  });

  it("persists offset and topics across reloads", async () => {
    const root = freshRoot();
    const s = await loadTelegramState(root);
    await s.setOffset(99);
    await s.setTopic("cockpit", "t1", 42);
    const s2 = await loadTelegramState(root);
    expect(s2.offset()).toBe(99);
    expect(s2.getTopic("cockpit", "t1")).toBe(42);
  });

  it("findTask reverse-maps a thread id to {project, taskId}", async () => {
    const s = await loadTelegramState(freshRoot());
    await s.setTopic("cockpit", "t1", 42);
    await s.setTopic("brove", "t2", 7);
    expect(s.findTask("cockpit", 42)).toEqual({ project: "cockpit", taskId: "t1" });
    expect(s.findTask("brove", 7)).toEqual({ project: "brove", taskId: "t2" });
    expect(s.findTask("cockpit", 999)).toBeUndefined();
  });

  it("findTask scopes to project — same threadId in two projects resolves independently", async () => {
    const s = await loadTelegramState(freshRoot());
    // Both projects' first crew topic gets threadId=2 (small ids are common)
    await s.setTopic("cockpit", "t1", 2);
    await s.setTopic("brove", "t2", 2);
    expect(s.findTask("cockpit", 2)).toEqual({ project: "cockpit", taskId: "t1" });
    expect(s.findTask("brove", 2)).toEqual({ project: "brove", taskId: "t2" });
    // Does not cross-match
    expect(s.findTask("cockpit", 7)).toBeUndefined();
  });
});
