import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { createCmuxDriver, RuntimeRegistry } from "../runtimes/index.js";

export const shutdownCommand = new Command("shutdown")
  .description(
    "Shutdown command + all captain workspaces (no args) or one captain workspace",
  )
  .argument("[project]", "Project name to shut down captain for")
  .action(async (project: string | undefined) => {
    const config = loadConfig();
    const runtimes = new RuntimeRegistry({ cmux: createCmuxDriver() });

    if (!project) {
      const globalRuntime = runtimes.global(config);
      const workspaces = await globalRuntime.list();
      const captainNames = Object.values(config.projects).map((p) => p.captainName);
      const commandName = config.commandName || "command";
      const cockpitWorkspaces = workspaces.filter(
        (w) => w.name === commandName || captainNames.includes(w.name),
      );

      if (cockpitWorkspaces.length === 0) {
        console.log(chalk.yellow("\nNo cockpit workspaces found to close.\n"));
        return;
      }

      console.log(chalk.bold(`\nShutting down ${cockpitWorkspaces.length} workspace(s)...\n`));
      for (const ws of cockpitWorkspaces) {
        try {
          await globalRuntime.stop(ws.id);
          console.log(chalk.green(`  ✔ Closed: ${ws.name}`));
        } catch {
          console.log(chalk.red(`  ✘ Failed to close: ${ws.name}`));
        }
      }
      console.log("");
      return;
    }

    if (!config.projects[project]) {
      console.error(
        chalk.red(
          `\n  ✘ Project '${project}' not found. Run 'cockpit projects list' to see registered projects.\n`,
        ),
      );
      process.exit(1);
    }

    const captainName = config.projects[project].captainName;
    const runtime = runtimes.forProject(project, config);
    console.log(chalk.bold(`\nShutting down captain workspace for '${project}'...\n`));

    const ref = await runtime.status(captainName);
    if (!ref) {
      console.log(chalk.yellow(`  ⚠ Workspace '${captainName}' not found — already closed?\n`));
      return;
    }

    try {
      await runtime.stop(ref.id);
      console.log(chalk.green(`  ✔ Closed: ${captainName}\n`));
    } catch {
      console.error(chalk.red(`  ✘ Failed to close workspace '${captainName}'\n`));
      process.exit(1);
    }
  });
