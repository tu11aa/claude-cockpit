// src/control/headless/claude.ts
import type { HeadlessAdapter } from "./types.js";

export const claudeHeadless: HeadlessAdapter = {
  provider: "claude",
  buildCommand(task, sessionId) {
    const argv = ["claude", "-p", "--output-format", "json"];
    if (sessionId) argv.push("--resume", sessionId);
    argv.push(task);
    return argv;
  },
  parseResult(stdout, exitCode) {
    if (exitCode !== 0) {
      return { outcome: "failed", exitCode, error: stdout.slice(-2000) };
    }
    try {
      const j = JSON.parse(stdout);
      if (j.is_error) return { outcome: "failed", error: String(j.result ?? "is_error"), sessionId: j.session_id };
      return { outcome: "done", sessionId: j.session_id, payload: String(j.result ?? "") };
    } catch {
      return { outcome: "done", parseWarning: true, payload: stdout };
    }
  },
};
