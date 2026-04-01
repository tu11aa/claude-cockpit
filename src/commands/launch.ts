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

function isInsideCmux(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID;
}

function ensureCmuxReady(): void {
  if (isInsideCmux()) {
    // We're inside cmux — socket API is available
    return;
  }

  // We're outside cmux — can't use the socket API
  // Open cmux app and tell the user to run from inside
  console.log(chalk.yellow("\n  Not running inside cmux. Opening cmux app...\n"));
  execSync(`open "${CMUX_APP}"`, { stdio: "inherit" });
  console.log(chalk.bold("  Run `cockpit launch` from inside a cmux workspace.\n"));
  process.exit(0);
}

function findWorkspaceRef(name: string): string | null {
  try {
    const output = cmux("list-workspaces");
    for (const line of output.split("\n")) {
      const match = line.match(/(workspace:\d+)\s+(.+?)(?:\s+\(.*\))?(?:\s+\[selected\])?$/);
      if (match && match[2]?.trim() === name) {
        return match[1]; // e.g. "workspace:3"
      }
    }
    return null;
  } catch {
    return null;
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

function launchWorkspace(name: string, cwd?: string, navigate = false, fresh = false, permissionMode = "default", allowedTools?: string): void {
  ensureCmuxReady();

  const existingRef = findWorkspaceRef(name);
  if (existingRef) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    cmux(`select-workspace --workspace "${existingRef}"`);
  } else {
    // Save current workspace ref to return focus later
    let currentRef: string | undefined;
    try {
      const cur = cmux("current-workspace");
      currentRef = cur.match(/workspace:\d+/)?.[0];
    } catch { /* ignore */ }

    // Create new workspace with claude session
    let claudeCmd = fresh ? "claude" : "claude -c";
    if (permissionMode === "acceptEdits") {
      claudeCmd += " --permission-mode acceptEdits";
    } else if (permissionMode === "bypassPermissions") {
      claudeCmd += " --dangerously-skip-permissions";
    }
    if (allowedTools) {
      claudeCmd += ` --allowedTools ${allowedTools}`;
    }
    const cwdFlag = cwd ? ` --cwd "${cwd}"` : "";
    const output = cmux(`new-workspace --command "${claudeCmd}"${cwdFlag}`);
    const wsId = output.match(/workspace:\d+/)?.[0] || output.split(/\s+/).pop() || "";

    // Rename to the desired name
    if (wsId) {
      cmux(`rename-workspace --workspace "${wsId}" "${name}"`);
    }

    const targetRef = wsId;

    if (navigate && targetRef) {
      // Navigate to the new workspace
      cmux(`select-workspace --workspace "${targetRef}"`);
    } else if (currentRef) {
      // Return focus to original workspace
      cmux(`select-workspace --workspace "${currentRef}"`);
    }

    console.log(chalk.green(`  ✔ Workspace '${name}' created`));
  }
}

export const launchCommand = new Command("launch")
  .description(
    "Launch command workspace (no args) or a captain workspace for a project",
  )
  .argument("[project]", "Project name to launch captain for")
  .option("--fresh", "Start a new session instead of resuming the last one")
  .action((project: string | undefined, opts: { fresh?: boolean }) => {
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
        launchWorkspace(workspaceName, hubPath, true, opts.fresh, config.defaults.permissions?.command || "default");
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
        launchWorkspace(workspaceName, projPath, false, opts.fresh, config.defaults.permissions?.captain || "acceptEdits");
      } catch (err) {
        console.error(
          chalk.red(`\n  ✘ Failed to launch workspace: ${(err as Error).message}\n`),
        );
        process.exit(1);
      }
    }
  });
