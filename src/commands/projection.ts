import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import {
  createCursorEmitter,
  createCodexEmitter,
  createGeminiEmitter,
  ProjectionRegistry,
  type ProjectionEmitter,
  type ProjectionSource,
} from "../projection/index.js";
import { createObsidianDriver } from "../workspaces/index.js";
import type { WorkspaceDriver } from "../workspaces/types.js";
import {
  readUserLevelSource,
  readProjectLevelSource,
} from "../lib/canonical-source.js";

type Opts = {
  scope?: "user" | "project";
  project?: string;
  target?: string;
  all?: boolean;
};

function buildRegistry(): ProjectionRegistry {
  return new ProjectionRegistry({
    cursor: createCursorEmitter,
    codex: createCodexEmitter,
    gemini: createGeminiEmitter,
  });
}

function resolveTargets(cfg: ReturnType<typeof loadConfig>, opts: Opts): string[] {
  if (opts.target) return [opts.target];
  return cfg.projection?.targets ?? ["cursor", "codex", "gemini"];
}

async function runEmit(opts: Opts & { dryRun?: boolean }) {
  const cfg = loadConfig();
  const registry = buildRegistry();
  const workspace: WorkspaceDriver = createObsidianDriver({ root: process.cwd() });
  const targets = resolveTargets(cfg, opts);

  const emittedCount = { written: 0, skipped: 0 };

  async function emitForTarget(
    emitter: ProjectionEmitter,
    scope: "user" | "project",
    source: ProjectionSource,
    projectRoot?: string,
  ) {
    for (const dest of emitter.destinations(scope, projectRoot)) {
      const result = await emitter.emit(source, dest, { dryRun: opts.dryRun });
      if (opts.dryRun) {
        console.log(chalk.cyan(`[${emitter.name}] ${dest.path}`));
        console.log(result.diff ?? "(no diff)");
      } else if (result.written) {
        console.log(
          chalk.green(
            `✔ ${emitter.name} → ${dest.path} (${result.bytesWritten} bytes)`,
          ),
        );
        emittedCount.written++;
      } else {
        console.log(chalk.gray(`- ${emitter.name} → ${dest.path} (skipped)`));
        emittedCount.skipped++;
      }
    }
  }

  const wantUser =
    opts.scope === "user" || opts.all || (!opts.project && !opts.scope);
  const wantProject = opts.scope === "project" || opts.all || !!opts.project;

  if (wantUser) {
    const source = await readUserLevelSource(workspace);
    for (const name of targets) {
      await emitForTarget(registry.get(name), "user", source);
    }
  }

  if (wantProject) {
    const projectNames = opts.project ? [opts.project] : Object.keys(cfg.projects);
    for (const projectName of projectNames) {
      const proj = cfg.projects[projectName];
      if (!proj) {
        console.error(chalk.yellow(`⚠ unknown project: ${projectName}`));
        continue;
      }
      const source = await readProjectLevelSource(workspace, proj.path);
      if (!source) {
        console.log(chalk.gray(`- ${projectName}: no AGENTS.md, skipping`));
        continue;
      }
      for (const name of targets) {
        await emitForTarget(registry.get(name), "project", source, proj.path);
      }
    }
  }

  if (!opts.dryRun) {
    console.log(
      chalk.bold(
        `\nProjection complete — ${emittedCount.written} written, ${emittedCount.skipped} skipped.`,
      ),
    );
  }
}

export const projectionCommand = new Command("projection").description(
  "Project cockpit instructions and skills to supported agent formats",
);

projectionCommand
  .command("emit")
  .description("Emit projections to disk")
  .option("--scope <scope>", "user or project", (v) => {
    if (v !== "user" && v !== "project") {
      throw new Error("--scope must be 'user' or 'project'");
    }
    return v;
  })
  .option("--project <name>", "managed project name")
  .option("--target <name>", "single target (cursor, codex, gemini)")
  .option("--all", "emit user-level + every managed project")
  .action(async (opts: Opts) => {
    try {
      await runEmit({ ...opts, dryRun: false });
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

projectionCommand
  .command("diff")
  .description("Preview changes without writing")
  .option("--scope <scope>", "user or project")
  .option("--project <name>", "managed project name")
  .option("--target <name>", "single target (cursor, codex, gemini)")
  .option("--all", "dry-run across user-level + every managed project")
  .action(async (opts: Opts) => {
    try {
      await runEmit({ ...opts, dryRun: true });
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

projectionCommand
  .command("list")
  .description("List registered projection targets")
  .action(() => {
    const registry = buildRegistry();
    for (const name of registry.list()) {
      const emitter = registry.get(name);
      const userDests = emitter.destinations("user").map((d) => d.path);
      const projectDests = emitter
        .destinations("project", "<project>")
        .map((d) => d.path);
      console.log(chalk.bold(name));
      console.log(`  user:    ${userDests.join(", ") || "(none)"}`);
      console.log(`  project: ${projectDests.join(", ") || "(none)"}`);
    }
  });
