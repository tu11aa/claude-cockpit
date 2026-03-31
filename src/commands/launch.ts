import { Command } from "commander";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadConfig } from "../config.js";

function workspaceExists(name: string): boolean {
  try {
    const output = execSync("cmux list-workspaces", { encoding: "utf-8" });
    // Each line: "  workspace:N  <name>"  or "* workspace:N  <name>  [selected]"
    return output.split("\n").some((line) => {
      const match = line.match(/workspace:\d+\s+(.+?)(?:\s+\(.*\))?(?:\s+\[selected\])?$/);
      return match?.[1]?.trim() === name;
    });
  } catch {
    return false;
  }
}

function launchWorkspace(name: string, cwd?: string): void {
  if (workspaceExists(name)) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    execSync(`cmux select-workspace --workspace "${name}"`, { stdio: "inherit" });
  } else {
    // Save current workspace to return focus
    let current: string | undefined;
    try {
      current = execSync("cmux current-workspace", { encoding: "utf-8" }).trim().split(/\s+/)[0];
    } catch { /* ignore */ }

    // Create new workspace with claude session
    const cmdFlag = cwd ? `--command "claude" --cwd "${cwd}"` : `--command "claude"`;
    const output = execSync(`cmux new-workspace ${cmdFlag}`, { encoding: "utf-8" }).trim();
    const wsId = output.match(/workspace:\d+/)?.[0] || output.split(/\s+/).pop() || "";

    // Rename to the desired name
    if (wsId) {
      execSync(`cmux rename-workspace --workspace "${wsId}" "${name}"`, { stdio: "inherit" });
    }

    // Return focus to original workspace so we don't steal focus
    if (current) {
      execSync(`cmux select-workspace --workspace "${current}"`, { stdio: "inherit" });
    }

    console.log(chalk.green(`  ✔ Workspace '${name}' created`));
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
      const workspaceName = proj.captainName;
      console.log(
        chalk.bold(
          `\nLaunching captain workspace for '${project}' (${proj.captainName})\n`,
        ),
      );

      try {
        launchWorkspace(workspaceName, proj.path);
      } catch (err) {
        console.error(
          chalk.red(`\n  ✘ Failed to launch workspace: ${(err as Error).message}\n`),
        );
        process.exit(1);
      }
    }
  });
