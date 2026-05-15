import fs from "node:fs";
import path from "node:path";
import type { CockpitConfig, ReactionsConfig } from "../config.js";
import { resolveHome } from "../config.js";
import type { RuntimeDriver } from "../runtimes/types.js";
import { classifyScreen, type ScreenState } from "./status-classifier.js";
import {
  readCrewSentinels,
  crewStateDir,
  alreadyNudged,
  markNudged,
  type CrewSignalState,
} from "../lib/crew-sentinel.js";

export interface AutoStatusResult {
  project: string;
  state: ScreenState;
  vaultPath: string;
  crewSignals: { crew: string; state: CrewSignalState; ts: string; excerpt: string }[];
}

export interface AutoStatusDeps {
  config: CockpitConfig;
  reactions: ReactionsConfig;
  runtime: (project: string) => RuntimeDriver;
  now?: () => string;
  writeFile?: (filePath: string, content: string) => void;
  mkdir?: (dirPath: string) => void;
  stateDir?: string;
}

const DEFAULT_AUTO_STATUS = { enabled: true, lines: 50, excerpt_lines: 15 };

function buildStatusMarkdown(input: {
  project: string;
  captainWorkspace: string;
  state: ScreenState;
  lastChecked: string;
  excerpt: string;
  crewSignals: { crew: string; state: CrewSignalState; ts: string; excerpt: string }[];
}): string {
  const fenced = "```";
  const crewLines =
    input.crewSignals.length === 0
      ? ["_none_"]
      : input.crewSignals.map(
          (c) => `- **${c.crew}** — ${c.state} @ ${c.ts}: ${c.excerpt || "(no detail)"}`,
        );
  return [
    "---",
    `project: ${input.project}`,
    `auto_state: ${input.state}`,
    `auto_last_checked: "${input.lastChecked}"`,
    `captain_workspace: ${input.captainWorkspace}`,
    `crew_signals: ${input.crewSignals.length}`,
    "---",
    "",
    "# Status (auto-derived)",
    "",
    "> Written by `cockpit reactor poll-status`. Manual writes (`write-status.sh`) are opt-in and may be clobbered on the next poll.",
    "",
    "## Last activity excerpt",
    "",
    fenced,
    input.excerpt,
    fenced,
    "",
    "## Crew signals",
    "",
    ...crewLines,
    "",
  ].join("\n");
}

export async function runAutoStatus(deps: AutoStatusDeps): Promise<AutoStatusResult[]> {
  const cfg = deps.reactions.auto_status ?? DEFAULT_AUTO_STATUS;
  if (!cfg.enabled) return [];

  const lines = cfg.lines ?? DEFAULT_AUTO_STATUS.lines;
  const excerptLines = cfg.excerpt_lines ?? DEFAULT_AUTO_STATUS.excerpt_lines;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const writeFile = deps.writeFile ?? ((p, c) => fs.writeFileSync(p, c));
  const mkdir = deps.mkdir ?? ((p) => fs.mkdirSync(p, { recursive: true }));
  const stateDir = deps.stateDir ?? crewStateDir();

  const results: AutoStatusResult[] = [];

  for (const [name, project] of Object.entries(deps.config.projects)) {
    const captain = project.captainName;
    const vaultDir = resolveHome(project.spokeVault);
    const statusPath = path.join(vaultDir, "status.md");

    let screen = "";
    try {
      const driver = deps.runtime(name);
      screen = await driver.readScreen(captain);
    } catch {
      screen = "";
    }

    const { state, excerpt } = classifyScreen(screen, { lines, excerptLines });

    const sentinels = readCrewSentinels(stateDir, name);
    const crewSignals = sentinels.map((s) => ({
      crew: s.crew,
      state: s.state,
      ts: s.ts,
      excerpt: s.excerpt,
    }));
    const hasBlockedCrew = sentinels.some((s) => s.state === "blocked");
    const projectState: ScreenState = hasBlockedCrew ? "blocked" : state;

    for (const s of sentinels) {
      if (alreadyNudged(stateDir, s)) continue;
      try {
        await deps.runtime(name).send(
          captain,
          `crew ${s.crew} is ${s.state}: ${s.excerpt || "(no detail)"} — collect/unblock it`,
        );
        markNudged(stateDir, s);
      } catch {
        // best-effort: captain may be down; reactor record is the guarantee
      }
    }

    try {
      mkdir(vaultDir);
      writeFile(statusPath, buildStatusMarkdown({
        project: name,
        captainWorkspace: captain,
        state: projectState,
        lastChecked: now,
        excerpt,
        crewSignals,
      }));
    } catch {
      // best-effort: skip projects whose vault is unreachable
    }

    results.push({ project: name, state: projectState, vaultPath: statusPath, crewSignals });
  }

  return results;
}
