import { Command } from "commander";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { loadConfig } from "../config.js";

const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";

function cmux(args: string): string {
  return execSync(`"${CMUX_BIN}" ${args}`, { encoding: "utf-8" }).trim();
}

interface WorkspaceEntry {
  ref: string;   // e.g. "workspace:3"
  name: string;  // e.g. "brove-captain"
}

function getWorkspaces(): WorkspaceEntry[] {
  try {
    const output = cmux("list-workspaces");
    return output.split("\n")
      .map((line) => {
        const match = line.match(/(workspace:\d+)\s+(.+?)(?:\s+\(.*\))?(?:\s+\[selected\])?$/);
        if (!match) return null;
        return { ref: match[1], name: match[2].trim() };
      })
      .filter((e): e is WorkspaceEntry => e !== null);
  } catch {
    return [];
  }
}

function closeWorkspace(ref: string): boolean {
  try {
    cmux(`close-workspace --workspace "${ref}"`);
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
      const workspaces = getWorkspaces();
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
        const ok = closeWorkspace(ws.ref);
        if (ok) {
          console.log(chalk.green(`  ✔ Closed: ${ws.name}`));
        } else {
          console.log(chalk.red(`  ✘ Failed to close: ${ws.name}`));
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

      const captainName = config.projects[project].captainName;
      console.log(chalk.bold(`\nShutting down captain workspace for '${project}'...\n`));

      const workspaces = getWorkspaces();
      const ws = workspaces.find((w) => w.name === captainName);
      if (!ws) {
        console.log(chalk.yellow(`  ⚠ Workspace '${captainName}' not found — already closed?\n`));
        return;
      }

      const ok = closeWorkspace(ws.ref);
      if (ok) {
        console.log(chalk.green(`  ✔ Closed: ${captainName}\n`));
      } else {
        console.error(chalk.red(`  ✘ Failed to close workspace '${captainName}'\n`));
        process.exit(1);
      }
    }
  });
