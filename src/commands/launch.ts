import { Command } from "commander";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { loadConfig, resolveHome } from "../config.js";

const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
const CMUX_APP = "/Applications/cmux.app";
const TEMPLATES_DIR = path.join(os.homedir(), ".config", "cockpit", "templates");

function cmux(args: string): string {
  return execSync(`"${CMUX_BIN}" ${args}`, { encoding: "utf-8" }).trim();
}

function isInsideCmux(): boolean {
  return !!process.env.CMUX_WORKSPACE_ID;
}

function ensureCmuxReady(): void {
  if (isInsideCmux()) return;

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
        return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function buildClaudeCmd(role: string, fresh: boolean, permissionMode: string): string {
  let cmd = fresh ? "claude" : "claude -c";

  if (permissionMode === "acceptEdits") {
    cmd += " --permission-mode acceptEdits";
  } else if (permissionMode === "bypassPermissions") {
    cmd += " --dangerously-skip-permissions";
  }

  // Append role-specific CLAUDE.md via system prompt (preserves project's own CLAUDE.md)
  const roleFile = path.join(TEMPLATES_DIR, `${role}.CLAUDE.md`);
  if (fs.existsSync(roleFile)) {
    cmd += ` --append-system-prompt-file ${roleFile}`;
  }

  // Captains also get learnings instructions
  if (role === "captain") {
    const learningsFile = path.join(TEMPLATES_DIR, "learnings.CLAUDE.md");
    if (fs.existsSync(learningsFile)) {
      cmd += ` --append-system-prompt-file ${learningsFile}`;
    }
  }

  return cmd;
}

function launchWorkspace(name: string, claudeCmd: string, cwd?: string, navigate = false): void {
  ensureCmuxReady();

  const existingRef = findWorkspaceRef(name);
  if (existingRef) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    cmux(`select-workspace --workspace "${existingRef}"`);
  } else {
    let currentRef: string | undefined;
    try {
      const cur = cmux("current-workspace");
      currentRef = cur.match(/workspace:\d+/)?.[0];
    } catch { /* ignore */ }

    const cwdFlag = cwd ? ` --cwd "${cwd}"` : "";
    const output = cmux(`new-workspace --command "${claudeCmd}"${cwdFlag}`);
    const wsId = output.match(/workspace:\d+/)?.[0] || output.split(/\s+/).pop() || "";

    if (wsId) {
      cmux(`rename-workspace --workspace "${wsId}" "${name}"`);
    }

    if (navigate && wsId) {
      cmux(`select-workspace --workspace "${wsId}"`);
    } else if (currentRef) {
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
      fs.mkdirSync(hubPath, { recursive: true });

      const claudeCmd = buildClaudeCmd("command", !!opts.fresh, config.defaults.permissions?.command || "default");

      console.log(chalk.bold(`\nLaunching command workspace: ${workspaceName}\n`));
      try {
        launchWorkspace(workspaceName, claudeCmd, hubPath, true);
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
      const projPath = resolveHome(proj.path);
      const claudeCmd = buildClaudeCmd("captain", !!opts.fresh, config.defaults.permissions?.captain || "acceptEdits");

      console.log(
        chalk.bold(
          `\nLaunching captain workspace for '${project}' (${proj.captainName})\n`,
        ),
      );

      try {
        launchWorkspace(proj.captainName, claudeCmd, projPath);
      } catch (err) {
        console.error(
          chalk.red(`\n  ✘ Failed to launch workspace: ${(err as Error).message}\n`),
        );
        process.exit(1);
      }
    }
  });
