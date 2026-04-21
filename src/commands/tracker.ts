import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, loadReactions, type CockpitConfig, type ReactionsConfig } from "../config.js";
import { createGitHubDriver, TrackerRegistry } from "../trackers/index.js";
import type { TrackerDriver } from "../trackers/types.js";

function buildRegistry(): TrackerRegistry {
  return new TrackerRegistry({ github: createGitHubDriver });
}

function resolveDriver(
  registry: TrackerRegistry,
  config: CockpitConfig,
  reactions: ReactionsConfig,
  project: string,
): TrackerDriver {
  return registry.forProject(project, config, reactions);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export const trackerCommand = new Command("tracker")
  .description("Interact with the tracker layer (issues/PRs). Bridges bash scripts to the TrackerDriver.");

trackerCommand
  .command("create-issue")
  .description("Create an issue in the project's tracker repo")
  .argument("<project>", "Project name")
  .argument("<title>", "Issue title")
  .option("--body <body>", "Issue body (use '-' to read from stdin)", "")
  .option("--label <labels>", "Comma-separated labels", "")
  .action(async (project: string, title: string, opts: { body: string; label: string }) => {
    const config = loadConfig();
    const reactions = loadReactions();
    try {
      const driver = resolveDriver(buildRegistry(), config, reactions, project);
      const body = opts.body === "-" ? await readStdin() : opts.body;
      const labels = opts.label ? opts.label.split(",").map((l) => l.trim()).filter(Boolean) : undefined;
      const result = await driver.createIssue({ title, body, labels });
      console.log(result.url);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

trackerCommand
  .command("merge-pr")
  .description("Enable auto-merge on a PR with the given method")
  .argument("<project>", "Project name")
  .argument("<number>", "PR number")
  .option("--method <method>", "Merge method: squash, merge, rebase", "squash")
  .action(async (project: string, numberStr: string, opts: { method: string }) => {
    const config = loadConfig();
    const reactions = loadReactions();
    try {
      const driver = resolveDriver(buildRegistry(), config, reactions, project);
      const method = (opts.method === "merge" || opts.method === "rebase" ? opts.method : "squash") as "merge" | "squash" | "rebase";
      await driver.mergePullRequest(Number(numberStr), method);
      console.log(chalk.green(`✔ Merge enabled for PR #${numberStr} (${method})`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

trackerCommand
  .command("get-checks")
  .description("Print PR check runs")
  .argument("<project>", "Project name")
  .argument("<number>", "PR number")
  .option("-j, --json", "Output as JSON")
  .action(async (project: string, numberStr: string, opts: { json?: boolean }) => {
    const config = loadConfig();
    const reactions = loadReactions();
    try {
      const driver = resolveDriver(buildRegistry(), config, reactions, project);
      const checks = await driver.getPullRequestChecks(Number(numberStr));
      if (opts.json) {
        console.log(JSON.stringify(checks, null, 2));
      } else {
        for (const c of checks) {
          console.log(`${c.state.padEnd(8)}${c.name}`);
        }
      }
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

trackerCommand
  .command("get-run-log")
  .description("Print the failing log tail of a workflow run")
  .argument("<project>", "Project name")
  .argument("<run-id>", "Run ID")
  .option("--tail <n>", "Tail N lines", "100")
  .action(async (project: string, runId: string, opts: { tail: string }) => {
    const config = loadConfig();
    const reactions = loadReactions();
    try {
      const driver = resolveDriver(buildRegistry(), config, reactions, project);
      const log = await driver.getRunLog(runId, { tail: Number(opts.tail) });
      process.stdout.write(log);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

trackerCommand
  .command("list-issues")
  .description("List issues in the project's tracker repo")
  .argument("<project>", "Project name")
  .option("--label <label>", "Filter by label")
  .option("--state <state>", "open | closed", "open")
  .option("--unassigned", "Only unassigned issues")
  .action(async (project: string, opts: { label?: string; state: string; unassigned?: boolean }) => {
    const config = loadConfig();
    const reactions = loadReactions();
    try {
      const driver = resolveDriver(buildRegistry(), config, reactions, project);
      const state = (opts.state === "closed" ? "closed" : "open") as "open" | "closed";
      const filter = {
        state,
        labels: opts.label ? [opts.label] : undefined,
        assigned: opts.unassigned ? false : undefined,
      };
      const issues = await driver.listIssues(filter);
      for (const i of issues) {
        console.log(`#${i.number}\t${i.title}`);
      }
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });
