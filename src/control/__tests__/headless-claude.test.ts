// src/control/__tests__/headless-claude.test.ts
import { describe, it, expect } from "vitest";
import { claudeHeadless } from "../headless/claude.js";

describe("claude headless adapter", () => {
  it("buildCommand emits print + json + the task", () => {
    const argv = claudeHeadless.buildCommand("fix the bug");
    expect(argv[0]).toBe("claude");
    expect(argv).toContain("-p");
    expect(argv.join(" ")).toContain("--output-format json");
    expect(argv).toContain("fix the bug");
  });

  it("buildCommand with sessionId adds --resume", () => {
    const argv = claudeHeadless.buildCommand("more", "sess-1");
    expect(argv.join(" ")).toContain("--resume sess-1");
  });

  it("parseResult: exit 0 + JSON result → done with sessionId", () => {
    const out = claudeHeadless.parseResult('{"result":"ok","session_id":"s9","is_error":false}', 0);
    expect(out).toEqual({ outcome: "done", sessionId: "s9", payload: "ok" });
  });

  it("parseResult: is_error true → failed", () => {
    const out = claudeHeadless.parseResult('{"result":"bad","is_error":true}', 0);
    expect(out.outcome).toBe("failed");
  });

  it("parseResult: non-zero exit → failed with exitCode", () => {
    const out = claudeHeadless.parseResult("crashed", 1);
    expect(out).toMatchObject({ outcome: "failed", exitCode: 1 });
  });

  it("parseResult: exit 0 but unparseable → done with parseWarning", () => {
    const out = claudeHeadless.parseResult("not json", 0);
    expect(out).toMatchObject({ outcome: "done", parseWarning: true });
  });
});
