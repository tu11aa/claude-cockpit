// src/control/__tests__/interactive-claude.test.ts
import { describe, it, expect } from "vitest";
import { mergeClaudeHooks } from "../interactive/claude.js";

const HOOK_CMD = "cockpit crew _hook";

describe("claude interactive hook merge", () => {
  it("adds Stop+SubagentStop+SessionEnd hooks to empty settings", () => {
    const out = mergeClaudeHooks({}, HOOK_CMD);
    expect(out.hooks.Stop[0].hooks[0].command).toContain(HOOK_CMD);
    expect(out.hooks.SubagentStop[0].hooks[0].command).toContain(HOOK_CMD);
    expect(out.hooks.SessionEnd[0].hooks[0].command).toContain(HOOK_CMD);
  });

  it("is idempotent — merging twice yields one cockpit entry per event", () => {
    const once = mergeClaudeHooks({}, HOOK_CMD);
    const twice = mergeClaudeHooks(once, HOOK_CMD);
    const cockpitEntries = twice.hooks.Stop.flatMap((m: any) => m.hooks)
      .filter((h: any) => h.command.includes(HOOK_CMD));
    expect(cockpitEntries).toHaveLength(1);
  });

  it("preserves a user's pre-existing unrelated Stop hook", () => {
    const existing = { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "user-thing" }] }] } };
    const out = mergeClaudeHooks(existing, HOOK_CMD);
    const cmds = out.hooks.Stop.flatMap((m: any) => m.hooks).map((h: any) => h.command);
    expect(cmds).toContain("user-thing");
    expect(cmds.some((c: string) => c.includes(HOOK_CMD))).toBe(true);
  });
});
