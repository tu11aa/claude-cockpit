// src/config.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ProjectConfig {
  path: string;
  captainName: string;
  spokeVault: string;
  host: string;
}

export interface PermissionConfig {
  command: string;   // permission mode for the command session
  captain: string;   // permission mode for captain sessions
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
    commandName: "command",
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
