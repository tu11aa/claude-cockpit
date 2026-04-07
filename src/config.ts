// src/config.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ProjectConfig {
  path: string;
  captainName: string;
  spokeVault: string;
  host: string;
  group?: string;
  groupRole?: string;
}

export interface PermissionConfig {
  command: string;   // permission mode for the command session
  captain: string;   // permission mode for captain sessions
  reactor?: string;  // permission mode for reactor session
}

export type ModelAlias = "opus" | "sonnet" | "haiku";

export interface ModelRoutingConfig {
  command: ModelAlias;
  captain: ModelAlias;
  crew: ModelAlias;
  reactor: ModelAlias;
  exploration: ModelAlias;
  review: ModelAlias;
}

// --- Reaction Engine Types ---

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
}

export interface GitHubProjectConfig {
  owner: string;
  number: number;
  status_field: string;
  columns: {
    ready: string;
    in_progress: string;
    review: string;
    done: string;
  };
}

export interface ReactionTrigger {
  label?: string;
  state?: string;
  not_assigned?: boolean;
  checks?: "success" | "failure" | "pending";
  review_decision?: "approved" | "changes_requested" | "review_required";
  no_update_for?: string;   // e.g. "2h", "30m"
  status_contains?: string;
  event?: string;
}

export interface ReactionRule {
  enabled: boolean;
  source: "github-issues" | "github-prs" | "captain-status";
  trigger: ReactionTrigger;
  action: "delegate-to-captain" | "send-to-captain" | "auto-merge" | "escalate" | "update-project-status" | "send-to-command";
  message?: string;
  priority?: "normal" | "high";
  project_status?: string;
  merge_method?: "merge" | "squash" | "rebase";
  retries?: number;
  escalate_after?: string;  // e.g. "30m"
}

export interface ReactionsConfig {
  engine: {
    poll_interval: string;    // e.g. "5m"
    state_file: string;
    max_retries: number;
  };
  github: {
    repos: Record<string, GitHubRepoConfig>;
    project?: GitHubProjectConfig;
  };
  reactions: Record<string, ReactionRule>;
}

export interface CockpitConfig {
  commandName: string;
  hubVault: string;
  projects: Record<string, ProjectConfig>;
  defaults: {
    maxCrew: number;
    worktreeDir: string;
    teammateMode: string;
    permissions: PermissionConfig;
    models?: ModelRoutingConfig;
  };
  metrics: {
    enabled: boolean;
    path: string;
  };
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "cockpit");
export const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function getDefaultConfig(): CockpitConfig {
  return {
    commandName: "\u{1F3DB}\u{FE0F} command",
    hubVault: path.join(os.homedir(), "cockpit-hub"),
    projects: {},
    defaults: {
      maxCrew: 5,
      worktreeDir: ".worktrees",
      teammateMode: "in-process",
      permissions: {
        command: "default",
        captain: "acceptEdits",
      },
      models: {
        command: "opus",
        captain: "opus",
        crew: "sonnet",
        reactor: "sonnet",
        exploration: "haiku",
        review: "opus",
      },
    },
    metrics: {
      enabled: true,
      path: path.join(CONFIG_DIR, "metrics.json"),
    },
  };
}

export function loadConfig(configPath = DEFAULT_CONFIG_PATH): CockpitConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as CockpitConfig;
  } catch {
    return getDefaultConfig();
  }
}

export function saveConfig(
  config: CockpitConfig,
  configPath = DEFAULT_CONFIG_PATH,
): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function resolveHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", os.homedir()) : p;
}

// --- Reactions Config ---

export const DEFAULT_REACTIONS_PATH = path.join(CONFIG_DIR, "reactions.json");

export function loadReactions(reactionsPath = DEFAULT_REACTIONS_PATH): ReactionsConfig {
  try {
    const raw = fs.readFileSync(reactionsPath, "utf-8");
    return JSON.parse(raw) as ReactionsConfig;
  } catch {
    return {
      engine: {
        poll_interval: "5m",
        state_file: path.join(CONFIG_DIR, "reactor-state.json"),
        max_retries: 2,
      },
      github: { repos: {} },
      reactions: {},
    };
  }
}

export function saveReactions(
  reactions: ReactionsConfig,
  reactionsPath = DEFAULT_REACTIONS_PATH,
): void {
  const dir = path.dirname(reactionsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reactionsPath, JSON.stringify(reactions, null, 2) + "\n");
}
