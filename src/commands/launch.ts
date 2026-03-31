import { Command } from "commander";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadConfig, resolveHome } from "../config.js";

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
  if (workspaceExists(name)) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    execSync(`cmux select-workspace --workspace "${name}"`, { stdio: "inherit" });
  } else {
    // Create new workspace with claude session
    const cwdFlag = cwd ? ` --cwd "${cwd}"` : "";
    const output = execSync(`cmux new-workspace --command "claude"${cwdFlag}`, { encoding: "utf-8" }).trim();
    const wsId = output.match(/workspace:\d+/)?.[0] || output.split(/\s+/).pop() || "";

    // Rename to the desired name
    if (wsId) {
      execSync(`cmux rename-workspace --workspace "${wsId}" "${name}"`, { stdio: "inherit" });
    }

    // Navigate to the new workspace if requested
    if (navigate) {
      execSync(`cmux select-workspace --workspace "${name}"`, { stdio: "inherit" });
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
