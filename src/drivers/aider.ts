import { execSync } from "node:child_process";
import type { AgentDriver, AgentProbeResult, SpawnOptions, AgentResult } from "./types.js";

export function createAiderDriver(): AgentDriver {
  return {
    name: "aider",
    templateSuffix: "generic",

    async probe(): Promise<AgentProbeResult> {
      try {
        const version = execSync("aider --version", { encoding: "utf-8" }).trim();
        return {
          installed: true,
          version,
          capabilities: ["auto_approve", "model_routing"],
        };
      } catch {
        return { installed: false, version: "", capabilities: [] };
      }
    },

    buildCommand(opts: SpawnOptions): string {
      let cmd = `aider --message "${opts.prompt.replace(/"/g, '\\"')}" --no-stream`;
      if (opts.model) cmd += ` --model ${opts.model}`;
      if (opts.autoApprove) cmd += " --yes";
      return cmd;
    },

    parseOutput(raw: string): AgentResult {
      return { status: "success", output: raw.trim() };
    },

    async stop(pid: number): Promise<void> {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    },
  };
}
