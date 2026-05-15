import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { runAutoStatus } from "../auto-status.js";
import { writeCrewSentinel } from "../../lib/crew-sentinel.js";
import type { RuntimeDriver } from "../../runtimes/types.js";

function fakeRuntime(sent: string[]): RuntimeDriver {
  return {
    name: "fake",
    async send(_ref: string, message: string) { sent.push(message); },
    async sendKey() {},
    async readScreen() { return ""; }, // captain offline/idle
    async sendToPane() {},
    async readPaneScreen() { return ""; },
  } as unknown as RuntimeDriver;
}

describe("runAutoStatus crew backstop", () => {
  it("escalates project state to blocked from a crew sentinel with captain offline, and nudges once", async () => {
    const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cockpit-as-state-"));
    const vault = await fsp.mkdtemp(path.join(os.tmpdir(), "cockpit-as-vault-"));
    const sent: string[] = [];
    try {
      writeCrewSentinel(stateDir, {
        project: "oneplan",
        crew: "crew-1",
        state: "blocked",
        event: "Notification",
        ts: "2026-05-15T09:00:00.000Z",
        excerpt: "which auth lib?",
      });

      const deps = {
        config: { projects: { oneplan: { captainName: "oneplan-captain", spokeVault: vault } } },
        reactions: { auto_status: { enabled: true, lines: 50, excerpt_lines: 15 } },
        runtime: () => fakeRuntime(sent),
        stateDir,
        now: () => "2026-05-15T10:00:00.000Z",
      } as unknown as Parameters<typeof runAutoStatus>[0];

      const r1 = await runAutoStatus(deps);
      expect(r1[0].state).toBe("blocked");
      expect(r1[0].crewSignals).toHaveLength(1);
      expect(r1[0].crewSignals[0].crew).toBe("crew-1");
      const md = await fsp.readFile(path.join(vault, "status.md"), "utf-8");
      expect(md).toContain("## Crew signals");
      expect(md).toContain("crew-1");
      expect(sent.filter((m) => m.includes("crew-1"))).toHaveLength(1);

      // second cycle: same sentinel ts → no duplicate nudge
      await runAutoStatus(deps);
      expect(sent.filter((m) => m.includes("crew-1"))).toHaveLength(1);
    } finally {
      await fsp.rm(stateDir, { recursive: true, force: true });
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });
});
