import type { InteractiveHookAdapter } from "./types.js";
import { claudeInteractive } from "./claude.js";
import { codexInteractive } from "./codex.js";

const ADAPTERS: Record<string, InteractiveHookAdapter> = {
  claude: claudeInteractive,
  codex: codexInteractive,
};

export function getInteractiveAdapter(provider: string): InteractiveHookAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`no interactive adapter for provider '${provider}'`);
  return a;
}
