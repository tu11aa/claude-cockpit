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

function workspaceExists(name: string): boolean {
  return cmuxWorkspaces().includes(name);
}

function launchWorkspace(name: string): void {
  if (workspaceExists(name)) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    execSync(`cmux select-workspace ${name}`, { stdio: "inherit" });
  } else {
    execSync(`cmux new-workspace`, { stdio: "inherit" });
    execSync(`cmux rename-workspace ${name}`, { stdio: "inherit" });
    execSync(`cmux select-workspace ${name}`, { stdio: "inherit" });
    console.log(chalk.green(`  ✔ Workspace '${name}' created and selected`));
  }
}

export const launchCommand = new Command("launch")
  .description(
    "Launch command workspace (no args) or a captain workspace for a project",
  )
  .argument("[project]", "Project name to launch captain for")
  .action((project: string | undefined) => {
    const config = loadConfig();

    if (!project) {
      // Launch command workspace
      const workspaceName = config.commandName || "command";
      console.log(chalk.bold(`\nLaunching command workspace: ${workspaceName}\n`));
      try {
        launchWorkspace(workspaceName);
      } catch (err) {
        console.error(chalk.red(`\n  ✘ Failed to launch workspace: ${(err as Error).message}\n`));
        process.exit(1);
      }
    } else {
      // Launch captain workspace for a project
      if (!config.projects[project]) {
        console.error(
          chalk.red(
            `\n  ✘ Project '${project}' not found. Run 'cockpit projects list' to see registered projects.\n`,
          ),
        );
        process.exit(1);
      }

      const proj = config.projects[project];
      const workspaceName = `captain-${project}`;
      console.log(
        chalk.bold(
          `\nLaunching captain workspace for '${project}' (${proj.captainName})\n`,
        ),
      );

      try {
        launchWorkspace(workspaceName);
      } catch (err) {
        console.error(
          chalk.red(`\n  ✘ Failed to launch workspace: ${(err as Error).message}\n`),
        );
        process.exit(1);
      }
    }
  });
