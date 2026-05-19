import type { InteractiveHookAdapter } from "./types.js";

// Codex hook surface is thin; reliable liveness for interactive codex needs a
// transcript/pid poll fallback. Foundational scope ships the adapter shell +
// tier marker; the poll fallback is wired by the launcher (Task 18) using pid.
export const codexInteractive: InteractiveHookAdapter = {
  provider: "codex",
  tier: "best-effort",
  injectHook(launchSpec) {
    return launchSpec; // no native hook injection; launcher adds pid poll
  },
};
