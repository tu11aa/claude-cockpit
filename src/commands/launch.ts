import { Command } from "commander";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadConfig, resolveHome } from "../config.js";

const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
const CMUX_APP = "/Applications/cmux.app";

function cmux(args: string, opts?: { encoding: "utf-8" }): string {
  return execSync(`"${CMUX_BIN}" ${args}`, opts ?? { encoding: "utf-8" }).trim();
}

function ensureCmuxRunning(): void {
  try {
    cmux("list-workspaces");
  } catch {
    // cmux app not running — open it and wait for it to be ready
    console.log(chalk.dim("  Starting cmux..."));
    execSync(`open "${CMUX_APP}"`, { stdio: "inherit" });
    // Wait for cmux to be responsive
    for (let i = 0; i < 10; i++) {
      try {
        execSync("sleep 1");
        cmux("list-workspaces");
        return;
      } catch { /* retry */ }
    }
    throw new Error("cmux failed to start after 10 seconds");
  }
}

function workspaceExists(name: string): boolean {
  try {
    const output = cmux("list-workspaces");
    return output.split("\n").some((line) => {
      const match = line.match(/workspace:\d+\s+(.+?)(?:\s+\(.*\))?(?:\s+\[selected\])?$/);
      return match?.[1]?.trim() === name;
    });
  } catch {
    return false;
  }
}

function findPackageRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (dir !== "/") {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function installClaudeMd(templateName: string, destDir: string): void {
  const pkgRoot = findPackageRoot();
  const src = path.join(pkgRoot, "orchestrator", templateName);
  const dest = path.join(destDir, "CLAUDE.md");
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

function launchWorkspace(name: string, cwd?: string, navigate = false): void {
  ensureCmuxRunning();

  if (workspaceExists(name)) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    cmux(`select-workspace --workspace "${name}"`);
  } else {
    // Create new workspace with claude session
    const cwdFlag = cwd ? ` --cwd "${cwd}"` : "";
    const output = cmux(`new-workspace --command "claude"${cwdFlag}`);
    const wsId = output.match(/workspace:\d+/)?.[0] || output.split(/\s+/).pop() || "";

    // Rename to the desired name
    if (wsId) {
      cmux(`rename-workspace --workspace "${wsId}" "${name}"`);
    }

    // Navigate to the new workspace if requested
    if (navigate) {
      cmux(`select-workspace --workspace "${name}"`);
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
      const hubPath = resolveHome(config.hubVault);

      // Ensure hub vault has CLAUDE.md so Claude knows it's the commander
      fs.mkdirSync(hubPath, { recursive: true });
      installClaudeMd("command.CLAUDE.md", hubPath);

      console.log(chalk.bold(`\nLaunching command workspace: ${workspaceName}\n`));
      try {
        launchWorkspace(workspaceName, hubPath, true);
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
      const projPath = resolveHome(proj.path);

      // Install captain CLAUDE.md so Claude knows it's a captain
      installClaudeMd("captain.CLAUDE.md", projPath);

      console.log(
        chalk.bold(
          `\nLaunching captain workspace for '${project}' (${proj.captainName})\n`,
        ),
      );

      try {
        launchWorkspace(workspaceName, projPath);
      } catch (err) {
        console.error(
          chalk.red(`\n  ✘ Failed to launch workspace: ${(err as Error).message}\n`),
        );
        process.exit(1);
      }
    }
  });
