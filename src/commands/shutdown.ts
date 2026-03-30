import { Command } from "commander";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadConfig } from "../config.js";

function cmuxWorkspaces(): string[] {
  try {
    const output = execSync("cmux list-workspaces", { encoding: "utf-8" });
    return output
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function closeWorkspace(name: string): boolean {
  try {
    execSync(`cmux close-workspace ${name}`, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

export const shutdownCommand = new Command("shutdown")
  .description(
    "Shutdown command + all captain workspaces (no args) or one captain workspace",
  )
  .argument("[project]", "Project name to shut down captain for")
  .action((project: string | undefined) => {
    const config = loadConfig();

    if (!project) {
      // Close all captain + command workspaces
      const workspaces = cmuxWorkspaces();
      const captainNames = Object.values(config.projects).map((p) => p.captainName);
      const cockpitWorkspaces = workspaces.filter(
        (w) =>
          w === (config.commandName || "command") ||
          captainNames.includes(w),
      );

      if (cockpitWorkspaces.length === 0) {
        console.log(chalk.yellow("\nNo cockpit workspaces found to close.\n"));
        return;
      }

      console.log(chalk.bold(`\nShutting down ${cockpitWorkspaces.length} workspace(s)...\n`));

      for (const ws of cockpitWorkspaces) {
        const ok = closeWorkspace(ws);
        if (ok) {
          console.log(chalk.green(`  ✔ Closed: ${ws}`));
        } else {
          console.log(chalk.red(`  ✘ Failed to close: ${ws}`));
        }
      }
      console.log("");
    } else {
      // Close captain workspace for one project
      if (!config.projects[project]) {
        console.error(
          chalk.red(
            `\n  ✘ Project '${project}' not found. Run 'cockpit projects list' to see registered projects.\n`,
          ),
        );
        process.exit(1);
      }

      const workspaceName = config.projects[project].captainName;
      console.log(chalk.bold(`\nShutting down captain workspace for '${project}'...\n`));

      const workspaces = cmuxWorkspaces();
      if (!workspaces.includes(workspaceName)) {
        console.log(chalk.yellow(`  ⚠ Workspace '${workspaceName}' not found — already closed?\n`));
        return;
      }

      const ok = closeWorkspace(workspaceName);
      if (ok) {
        console.log(chalk.green(`  ✔ Closed: ${workspaceName}\n`));
      } else {
        console.error(chalk.red(`  ✘ Failed to close workspace '${workspaceName}'\n`));
        process.exit(1);
      }
    }
  });
