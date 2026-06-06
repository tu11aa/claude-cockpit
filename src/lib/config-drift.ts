import type { CockpitConfig } from "../config.js";

export type DriftKind = "missing" | "deprecated" | "changed-default" | "invalid";
export type DriftSeverity = "info" | "advisory" | "warn";

export interface DriftItem {
  path: string;
  kind: DriftKind;
  severity: DriftSeverity;
  current?: unknown;
  suggested?: unknown;
  note?: string;
}

export const SAFE_KINDS: DriftKind[] = ["missing", "deprecated"];

const MANAGED_PATHS: string[] = [
  "defaults.maxCrew",
  "defaults.worktreeDir",
  "defaults.teammateMode",
  "defaults.permissions.*",
  "defaults.roles.*",
  "agents.*",
  "workspace",
  "notifier",
  "runtime",
];

const KNOWN_DEPRECATED: Array<{ path: string; when?: (u: CockpitConfig) => boolean; note: string }> = [
  {
    path: "defaults.models",
    when: (u) => u.defaults?.roles !== undefined,
    note: "superseded by defaults.roles",
  },
];

function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function hasPath(obj: unknown, dotted: string): boolean {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const k of parts) {
    if (!cur || typeof cur !== "object" || !(k in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

function expandManaged(managed: string, def: CockpitConfig): string[] {
  if (!managed.endsWith(".*")) return [managed];
  const parent = managed.slice(0, -2);
  const node = getPath(def, parent);
  if (!node || typeof node !== "object") return [];
  return Object.keys(node as Record<string, unknown>).map((k) => `${parent}.${k}`);
}

export function detectDrift(user: CockpitConfig, def: CockpitConfig): DriftItem[] {
  const items: DriftItem[] = [];

  for (const managed of MANAGED_PATHS) {
    for (const leaf of expandManaged(managed, def)) {
      const inDefault = hasPath(def, leaf);
      if (inDefault && !hasPath(user, leaf)) {
        items.push({ path: leaf, kind: "missing", severity: "info", suggested: getPath(def, leaf) });
      }
    }
  }

  for (const dep of KNOWN_DEPRECATED) {
    if (hasPath(user, dep.path) && (dep.when ? dep.when(user) : true)) {
      items.push({ path: dep.path, kind: "deprecated", severity: "info", current: getPath(user, dep.path), note: dep.note });
    }
  }

  return items;
}
