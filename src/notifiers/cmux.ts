import { execSync } from "node:child_process";
import type {
  NotifierDriver,
  NotifierProbeResult,
  NotifierScope,
} from "./types.js";

function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

export function createCmuxNotifier(_scope: NotifierScope): NotifierDriver {
  return {
    name: "cmux",

    async probe(): Promise<NotifierProbeResult> {
      try {
        execSync("cockpit runtime status --command", { encoding: "utf-8", stdio: "pipe" });
        return { installed: true, reachable: true };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT") {
          return { installed: false, reachable: false };
        }
        return { installed: true, reachable: false };
      }
    },

    async notify(message: string): Promise<void> {
      execSync(`cockpit runtime send --command "${escape(message)}"`, { encoding: "utf-8" });
    },
  };
}
