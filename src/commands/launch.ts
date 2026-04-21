import { Command } from "commander";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { loadConfig, resolveHome, type ModelRoutingConfig } from "../config.js";
import { createClaudeDriver, createCodexDriver, createGeminiDriver, createAiderDriver, CapabilityRegistry } from "../drivers/index.js";
import type { AgentDriver, Role } from "../drivers/types.js";
import { RuntimeRegistry, createCmuxDriver } from "../runtimes/index.js";
import type { RuntimeDriver } from "../runtimes/index.js";

const CMUX_APP = "/Applications/cmux.app";
// Retained for the select-workspace / current-workspace calls that are not yet abstracted by RuntimeDriver.
const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";
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
  const roleFile = path.join(TEMPLATES_DIR, `${role}.claude.md`);
  const legacyRoleFile = path.join(TEMPLATES_DIR, `${role}.CLAUDE.md`);
  if (fs.existsSync(roleFile)) {
    hash.update(fs.readFileSync(roleFile, "utf-8"));
  } else if (fs.existsSync(legacyRoleFile)) {
    hash.update(fs.readFileSync(legacyRoleFile, "utf-8"));
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

function buildAgentCmd(
  agentName: string,
  registry: CapabilityRegistry,
  role: string,
  fresh: boolean,
  permissionMode: string,
  model?: string,
): string {
  const driver = registry.getDriver(agentName);

  // For Claude, handle fresh vs continue and permission mode specially
  if (driver.name === "claude") {
    let cmd = fresh ? "claude" : "claude -c";

    if (permissionMode === "acceptEdits") {
      cmd += " --permission-mode acceptEdits";
    } else if (permissionMode === "bypassPermissions") {
      cmd += " --dangerously-skip-permissions";
    }

    if (model) {
      cmd += ` --model ${model}`;
    }

    const roleFile = path.join(TEMPLATES_DIR, `${role}.claude.md`);
    const legacyRoleFile = path.join(TEMPLATES_DIR, `${role}.CLAUDE.md`);
    const actualRoleFile = fs.existsSync(roleFile) ? roleFile : (fs.existsSync(legacyRoleFile) ? legacyRoleFile : null);
    if (actualRoleFile) {
      cmd += ` --append-system-prompt-file ${actualRoleFile}`;
    }

    const pluginDir = path.join(TEMPLATES_DIR, "..", "plugin");
    if (fs.existsSync(pluginDir)) {
      cmd += ` --plugin-dir ${pluginDir}`;
    }

    return cmd;
  }

  // For non-Claude agents, use the driver's buildCommand
  const roleFile = path.join(TEMPLATES_DIR, `${role}.${driver.templateSuffix}.md`);
  return driver.buildCommand({
    prompt: `You are a cockpit ${role}. Read your instructions from ${roleFile} and begin.`,
    workdir: process.cwd(),
    role: role as Role,
    model,
    autoApprove: true,
    promptFile: fs.existsSync(roleFile) ? roleFile : undefined,
  });
}

async function launchWorkspace(
  runtime: RuntimeDriver,
  name: string,
  agentCmd: string,
  cwd?: string,
  navigate = false,
  forceFresh = false,
  pinToTop = false,
  initialPrompt?: string,
): Promise<void> {
  ensureCmuxReady();

  const existing = await runtime.status(name);
  if (existing && forceFresh) {
    console.log(chalk.yellow(`  Closing stale workspace '${name}' for fresh start`));
    await runtime.stop(existing.id);
  } else if (existing) {
    console.log(chalk.yellow(`  Workspace '${name}' already exists — switching to it`));
    // TODO(runtime): select/focus not yet abstracted; direct cmux call retained intentionally
    execSync(`"${CMUX_BIN}" select-workspace --workspace "${existing.id}"`);
    return;
  }

  let currentRef: string | undefined;
  try {
    // TODO(runtime): current-workspace not yet abstracted
    const cur = execSync(`"${CMUX_BIN}" current-workspace`, { encoding: "utf-8" }).trim();
    currentRef = cur.match(/workspace:\d+/)?.[0];
  } catch { /* ignore */ }

  const ref = await runtime.spawn({
    name,
    workdir: cwd ?? process.cwd(),
    command: agentCmd,
    pinToTop,
  });

  if (initialPrompt) {
    // Small delay to let agent initialize before sending prompt
    setTimeout(() => {
      runtime.send(ref.id, initialPrompt).catch(() => { /* best-effort */ });
    }, 3000);
  }

  if (navigate) {
    // TODO(runtime): select not yet abstracted
    execSync(`"${CMUX_BIN}" select-workspace --workspace "${ref.id}"`);
  } else if (currentRef) {
    // TODO(runtime): select not yet abstracted
    execSync(`"${CMUX_BIN}" select-workspace --workspace "${currentRef}"`);
  }

  console.log(chalk.green(`  ✔ Workspace '${name}' created`));
}

export const launchCommand = new Command("launch")
  .description(
    "Launch command workspace (no args), a captain for a project, or --all for everything",
  )
  .argument("[project]", "Project name to launch captain for")
  .option("--fresh", "Start a new session instead of resuming the last one")
  .option("--all", "Launch command workspace + reactor + all captain workspaces")
  .option("--reactor", "Also launch the reactor workspace")
  .action(async (project: string | undefined, opts: { fresh?: boolean; all?: boolean; reactor?: boolean }) => {
    const config = loadConfig();

    // Build agent driver registry
    const drivers: Record<string, AgentDriver> = {
      claude: createClaudeDriver(),
      codex: createCodexDriver(),
      gemini: createGeminiDriver(),
      aider: createAiderDriver(),
    };
    const registry = new CapabilityRegistry(drivers);

    // Build runtime driver registry
    const runtimes = new RuntimeRegistry({ cmux: createCmuxDriver() });

    async function launchOne(
      workspaceName: string,
      role: string,
      cwd: string,
      permissionMode: string,
      navigate: boolean,
      pinToTop = false,
      projectName?: string,
    ): Promise<void> {
      let forceFresh = !!opts.fresh;
      if (!forceFresh) {
        const auto = shouldStartFresh(workspaceName, role);
        if (auto.fresh) {
          console.log(chalk.cyan(`  ↻ ${auto.reason}`));
          forceFresh = true;
        }
      }

      const roleConfig = config.defaults.roles?.[role as keyof NonNullable<typeof config.defaults.roles>];
      const agentName = roleConfig?.agent || "claude";
      const model = roleConfig?.model || config.defaults.models?.[role as keyof ModelRoutingConfig];
      const agentCmd = buildAgentCmd(agentName, registry, role, forceFresh, permissionMode, model);
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

      const runtime = projectName
        ? runtimes.forProject(projectName, config)
        : runtimes.global(config);

      try {
        await launchWorkspace(runtime, workspaceName, agentCmd, cwd, navigate, forceFresh, pinToTop, initialPrompt);
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
      await launchOne(workspaceName, "command", hubPath, config.defaults.permissions?.command || "default", true, true);

      // Launch reactor (after command, before captains)
      const reactorName = "⚡ reactor";
      console.log(chalk.bold(`\n  Reactor: ${reactorName}`));
      await launchOne(reactorName, "reactor", hubPath, config.defaults.permissions?.reactor || "default", false, true);

      for (const [name, proj] of Object.entries(config.projects)) {
        const projPath = resolveHome(proj.path);
        // Ensure spoke vault exists
        const spokePath = resolveHome(proj.spokeVault);
        if (!fs.existsSync(spokePath)) {
          fs.mkdirSync(spokePath, { recursive: true });
          for (const sub of ["crew", "learnings", "daily-logs", "skills", "meta", "templates", "wiki", "wiki/pages"]) {
            fs.mkdirSync(path.join(spokePath, sub), { recursive: true });
          }
          console.log(chalk.cyan(`  ✔ Created spoke vault at ${spokePath}`));
        }
        console.log(chalk.bold(`\n  Captain: ${proj.captainName} (${name})`));
        await launchOne(proj.captainName, "captain", projPath, config.defaults.permissions?.captain || "acceptEdits", false, true, name);
      }
      console.log("");
    } else if (!project) {
      // Launch command workspace only (+ reactor if --reactor)
      const workspaceName = config.commandName || "command";
      const hubPath = resolveHome(config.hubVault);
      fs.mkdirSync(hubPath, { recursive: true });

      console.log(chalk.bold(`\nLaunching command workspace: ${workspaceName}\n`));
      await launchOne(workspaceName, "command", hubPath, config.defaults.permissions?.command || "default", true, true);

      if (opts.reactor) {
        const reactorName = "⚡ reactor";
        console.log(chalk.bold(`\nLaunching reactor: ${reactorName}\n`));
        await launchOne(reactorName, "reactor", hubPath, config.defaults.permissions?.reactor || "default", false, true);
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
        for (const sub of ["crew", "learnings", "daily-logs", "skills", "meta", "templates", "wiki", "wiki/pages"]) {
          fs.mkdirSync(path.join(spokePath, sub), { recursive: true });
        }
        console.log(chalk.cyan(`  ✔ Created spoke vault at ${spokePath}`));
      }

      console.log(
        chalk.bold(
          `\nLaunching captain workspace for '${project}' (${proj.captainName})\n`,
        ),
      );
      await launchOne(proj.captainName, "captain", projPath, config.defaults.permissions?.captain || "acceptEdits", false, true, project);
    }
  });
