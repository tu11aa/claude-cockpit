import type { CockpitConfig, ReactionsConfig } from "../config.js";
import type {
  TrackerDriver,
  TrackerFactory,
  TrackerProbeResult,
} from "./types.js";

const DEFAULT_TRACKER = "github";

export class TrackerRegistry {
  constructor(private factories: Record<string, TrackerFactory>) {}

  forProject(
    projectName: string,
    config: CockpitConfig,
    reactions: ReactionsConfig,
  ): TrackerDriver {
    const proj = config.projects[projectName];
    if (!proj) throw new Error(`Project '${projectName}' not found`);
    const name = proj.tracker ?? config.tracker ?? DEFAULT_TRACKER;
    const repoConfig = reactions.github?.repos?.[projectName] ?? {};
    return this.get(name)({
      owner: (repoConfig as { owner?: string }).owner,
      repo: (repoConfig as { repo?: string }).repo,
    });
  }

  get(name: string): TrackerFactory {
    const factory = this.factories[name];
    if (!factory) {
      throw new Error(`Unknown tracker provider '${name}' — no factory registered`);
    }
    return factory;
  }

  async probeAll(): Promise<Record<string, TrackerProbeResult>> {
    const results: Record<string, TrackerProbeResult> = {};
    for (const [name, factory] of Object.entries(this.factories)) {
      try {
        const driver = factory({ owner: "probe", repo: "probe" });
        results[name] = await driver.probe();
      } catch {
        results[name] = { installed: false, authenticated: false };
      }
    }
    return results;
  }
}
