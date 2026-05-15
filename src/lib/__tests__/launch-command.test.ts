import { describe, it, expect } from "vitest";
import { buildLaunchCommand } from "../launch-command.js";

describe("buildLaunchCommand", () => {
  it("returns the command unchanged when there is no wiring", () => {
    expect(buildLaunchCommand("claude --plugin-dir /p", undefined)).toBe("claude --plugin-dir /p");
  });

  it("prefixes single-quoted env assignments", () => {
    const out = buildLaunchCommand("claude -p", {
      env: { COCKPIT_PROJECT: "oneplan", COCKPIT_CREW: "crew-1", COCKPIT_STATE_DIR: "/a/b" },
    });
    expect(out).toBe(
      "COCKPIT_PROJECT='oneplan' COCKPIT_CREW='crew-1' COCKPIT_STATE_DIR='/a/b' claude -p",
    );
  });

  it("escapes single quotes in values", () => {
    const out = buildLaunchCommand("claude", { env: { X: "a'b" } });
    expect(out).toBe("X='a'\\''b' claude");
  });

  it("appends argsSuffix when present", () => {
    const out = buildLaunchCommand("aider", { env: { X: "1" }, argsSuffix: "--notifications" });
    expect(out).toBe("X='1' aider --notifications");
  });
});
