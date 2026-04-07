import { Command } from "commander";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { loadConfig, resolveHome, type ModelRoutingConfig } from "../config.js";

const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
const CMUX_APP = "/Applications/cmux.app";
const TEMPLATES_DIR = path.join(os.homedir(), ".config", "cockpit", "templates");
const SESSIONS_PATH = path.join(os.homedir(), ".config", "cockpit", "sessions.json");

interface SessionRecord {
  lastLaunched: string; // YYYY-MM-DD
  templateHash: string;
}

interface SessionsFile {
  workspaces: Record<string, SessionRecord>;
}

function loadSessions(): SessionsFile {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf-8"));
  } catch {
    return { workspaces: {} };
  }
}

function saveSessions(sessions: SessionsFile): void {
  const dir = path.dirname(SESSIONS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2) + "\n");
}

function computeTemplateHash(role: string): string {
  const hash = crypto.createHash("sha256");

  // Hash the role template
  const roleFile = path.join(TEMPLATES_DIR, `${role}.CLAUDE.md`);
  if (fs.existsSync(roleFile)) {
    hash.update(fs.readFileSync(roleFile, "utf-8"));
  }

  // Also hash plugin skills so template changes trigger fresh sessions
  const pluginSkillsDir = path.join(TEMPLATES_DIR, "..", "plugin", "skills");
  if (fs.existsSync(pluginSkillsDir)) {
    for (const skill of fs.readdirSync(pluginSkillsDir).sort()) {
      const skillFile = path.join(pluginSkillsDir, skill, "SKILL.md");
      if (fs.existsSync(skillFile)) {
        hash.update(fs.readFileSync(skillFile, "utf-8"));
      }
    }
  }

  return hash.digest("hex").slice(0, 16);
}

function shouldStartFresh(
  workspaceName: string,
  role: string,
): { fresh: boolean; reason?: string } {
  const sessions = loadSessions();
  const record = sessions.workspaces[workspaceName];
  const today = new Date().toISOString().slice(0, 10);
  const currentHash = computeTemplateHash(role);

  if (!record) {
    return { fresh: true, reason: "first launch" };
  }

  if (record.lastLaunched !== today) {
    return { fresh: true, reason: "new day — starting fresh session" };
  }

  if (record.templateHash !== currentHash) {
    return { fresh: true, reason: "template instructions updated" };
  }

  return { fresh: false };
}

function recordSession(workspaceName: string, role: string): void {
  const sessions = loadSessions();
  sessions.workspaces[workspaceName] = {
    lastLaunched: new Date().toISOString().slice(0, 10),
    templateHash: computeTemplateHash(role),
  };
  saveSessions(sessions);
}

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

function buildClaudeCmd(role: string, fresh: boolean, permissionMode: string, model?: string): string {
  let cmd = fresh ? "claude" : "claude -c";

  if (permissionMode === "acceptEdits") {
    cmd += " --permission-mode acceptEdits";
  } else if (permissionMode === "bypassPermissions") {
    cmd += " --dangerously-skip-permissions";
  }

  if (model) {
    cmd += ` --model ${model}`;
  }

  // Append role-specific template (slim — detailed instructions are in cockpit skills)
  const roleFile = path.join(TEMPLATES_DIR, `${role}.CLAUDE.md`);
  if (fs.existsSync(roleFile)) {
    cmd += ` --append-system-prompt-file ${roleFile}`;
  }

  // Load cockpit plugin for skills (captain-ops, command-ops, daily-log, etc.)
  const pluginDir = path.join(TEMPLATES_DIR, "..", "plugin");
  if (fs.existsSync(pluginDir)) {
    cmd += ` --plugin-dir ${pluginDir}`;
  }

  return cmd;
}

function launchWorkspace(name: string, claudeCmd: string, cwd?: string, navigate = false, forceFresh = false, pinToTop = false, initialPrompt?: string): void {
  ensureCmuxReady();

  const existingRef = findWorkspaceRef(name);
  if (existingRef && forceFresh) {
    // Close stale workspace so a fresh one can be created
    console.log(chalk.yellow(`  Closing stale workspace '${name}' for fresh start`));
    try {
      cmux(`close-workspace --workspace "${existingRef}"`);
    } catch { /* may already be closing */ }
  } else if (existingRef) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    cmux(`select-workspace --workspace "${existingRef}"`);
    return;
  }

  {
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
      if (pinToTop) {
        try {
          cmux(`workspace-action --workspace "${wsId}" --action pin`);
        } catch { /* pin is best-effort */ }
      }
    }

    // Send initial prompt to trigger startup behavior
    if (wsId && initialPrompt) {
      // Small delay to let Claude Code initialize before sending prompt
      setTimeout(() => {
        try {
          cmux(`send --workspace "${wsId}" "${initialPrompt.replace(/"/g, '\\"')}"`);
        } catch { /* best-effort */ }
      }, 3000);
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
    "Launch command workspace (no args), a captain for a project, or --all for everything",
  )
  .argument("[project]", "Project name to launch captain for")
  .option("--fresh", "Start a new session instead of resuming the last one")
  .option("--all", "Launch command workspace + reactor + all captain workspaces")
  .option("--reactor", "Also launch the reactor workspace")
  .action((project: string | undefined, opts: { fresh?: boolean; all?: boolean; reactor?: boolean }) => {
    const config = loadConfig();

    function launchOne(
      workspaceName: string,
      role: string,
      cwd: string,
      permissionMode: string,
      navigate: boolean,
      pinToTop = false,
    ): void {
      let forceFresh = !!opts.fresh;
      if (!forceFresh) {
        const auto = shouldStartFresh(workspaceName, role);
        if (auto.fresh) {
          console.log(chalk.cyan(`  ↻ ${auto.reason}`));
          forceFresh = true;
        }
      }

      const model = config.defaults.models?.[role as keyof ModelRoutingConfig];
      const claudeCmd = buildClaudeCmd(role, forceFresh, permissionMode, model);
      recordSession(workspaceName, role);

      // Auto-trigger startup checklist
      let initialPrompt: string | undefined;
      if (role === "captain") {
        initialPrompt = "Run your startup checklist: use the cockpit:captain-ops skill, complete all startup steps, then report ready.";
      } else if (role === "command") {
        initialPrompt = "Run your startup checklist: use the cockpit:command-ops skill, complete your daily briefing, then report ready.";
      } else if (role === "reactor") {
        initialPrompt = "Run your startup checklist: use the cockpit:reactor-ops skill, verify gh auth, read reactions.json, then start your poll loop.";
      }

      try {
        launchWorkspace(workspaceName, claudeCmd, cwd, navigate, forceFresh, pinToTop, initialPrompt);
      } catch (err) {
        console.error(chalk.red(`  ✘ Failed: ${(err as Error).message}`));
      }
    }

    if (opts.all) {
      // Launch command + all captains
      const workspaceName = config.commandName || "command";
      const hubPath = resolveHome(config.hubVault);
      fs.mkdirSync(hubPath, { recursive: true });

      console.log(chalk.bold("\nLaunching all cockpit workspaces\n"));
      console.log(chalk.bold(`  Command: ${workspaceName}`));
      launchOne(workspaceName, "command", hubPath, config.defaults.permissions?.command || "default", true, true);

      // Launch reactor (after command, before captains)
      const reactorName = "⚡ reactor";
      console.log(chalk.bold(`\n  Reactor: ${reactorName}`));
      launchOne(reactorName, "reactor", hubPath, config.defaults.permissions?.reactor || "default", false, true);

      for (const [name, proj] of Object.entries(config.projects)) {
        const projPath = resolveHome(proj.path);
        // Ensure spoke vault exists
        const spokePath = resolveHome(proj.spokeVault);
        if (!fs.existsSync(spokePath)) {
          fs.mkdirSync(spokePath, { recursive: true });
          for (const sub of ["crew", "learnings", "daily-logs", "skills", "meta", "templates"]) {
            fs.mkdirSync(path.join(spokePath, sub), { recursive: true });
          }
          console.log(chalk.cyan(`  ✔ Created spoke vault at ${spokePath}`));
        }
        console.log(chalk.bold(`\n  Captain: ${proj.captainName} (${name})`));
        launchOne(proj.captainName, "captain", projPath, config.defaults.permissions?.captain || "acceptEdits", false, true);
      }
      console.log("");
    } else if (!project) {
      // Launch command workspace only (+ reactor if --reactor)
      const workspaceName = config.commandName || "command";
      const hubPath = resolveHome(config.hubVault);
      fs.mkdirSync(hubPath, { recursive: true });

      console.log(chalk.bold(`\nLaunching command workspace: ${workspaceName}\n`));
      launchOne(workspaceName, "command", hubPath, config.defaults.permissions?.command || "default", true, true);

      if (opts.reactor) {
        const reactorName = "⚡ reactor";
        console.log(chalk.bold(`\nLaunching reactor: ${reactorName}\n`));
        launchOne(reactorName, "reactor", hubPath, config.defaults.permissions?.reactor || "default", false, true);
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

      // Ensure spoke vault exists
      const spokePath = resolveHome(proj.spokeVault);
      if (!fs.existsSync(spokePath)) {
        fs.mkdirSync(spokePath, { recursive: true });
        for (const sub of ["crew", "learnings", "daily-logs", "skills", "meta", "templates"]) {
          fs.mkdirSync(path.join(spokePath, sub), { recursive: true });
        }
        console.log(chalk.cyan(`  ✔ Created spoke vault at ${spokePath}`));
      }

      console.log(
        chalk.bold(
          `\nLaunching captain workspace for '${project}' (${proj.captainName})\n`,
        ),
      );
      launchOne(proj.captainName, "captain", projPath, config.defaults.permissions?.captain || "acceptEdits", false, true);
    }
  });
