import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("plugin hooks.json", () => {
  it("registers cockpit crew-signal for Stop, SubagentStop, Notification", () => {
    const p = path.join(process.cwd(), "plugin", "hooks", "hooks.json");
    const json = JSON.parse(fs.readFileSync(p, "utf-8"));
    for (const ev of ["Stop", "SubagentStop", "Notification"]) {
      const entries = json.hooks[ev];
      expect(Array.isArray(entries)).toBe(true);
      const cmds = entries.flatMap(
        (e: { hooks: { type: string; command: string }[] }) => e.hooks,
      );
      expect(
        cmds.some(
          (h: { type: string; command: string }) =>
            h.type === "command" && h.command === "cockpit crew-signal",
        ),
      ).toBe(true);
    }
  });
});
