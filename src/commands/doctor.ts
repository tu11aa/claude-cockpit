import { Command } from "commander";
import { execSync } from "node:child_process";
import fs from "node:fs";
import chalk from "chalk";
import { loadConfig } from "../config.js";

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function claudeVersionOk(): boolean {
  try {
    const version = execSync("claude --version", { encoding: "utf-8" }).trim();
    const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return false;
    const [, major, minor, patch] = match.map(Number);
    return (
      major > 2 ||
      (major === 2 && minor > 1) ||
      (major === 2 && minor === 1 && patch >= 32)
    );
  } catch {
    return false;
  }
}

function settingsHaveAgentTeams(): boolean {
  try {
    const home = process.env.HOME || "";
    const settings = JSON.parse(
      fs.readFileSync(`${home}/.claude/settings.json`, "utf-8"),
    );
    return settings?.env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1";
  } catch {
    return false;
  }
}

function pluginInstalled(pluginKey: string): boolean {
  try {
    const home = process.env.HOME || "";
    const plugins = JSON.parse(
      fs.readFileSync(
        `${home}/.claude/plugins/installed_plugins.json`,
        "utf-8",
      ),
    );
    return pluginKey in (plugins?.plugins || {});
  } catch {
    return false;
  }
}

function nodeVersionOk(): boolean {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0], 10);
  return major >= 18;
}

function check(label: string, pass: boolean): boolean {
  const icon = pass ? chalk.green("✔ PASS") : chalk.red("✘ FAIL");
  console.log(`  ${icon}  ${label}`);
  return pass;
}

export const doctorCommand = new Command("doctor")
  .description("Check system health and prerequisites")
  .action(() => {
    console.log(chalk.bold("\nCockpit Doctor\n"));

    const results: boolean[] = [];

    results.push(check("Claude Code installed", commandExists("claude")));
    results.push(check("Claude Code version >= 2.1.32", claudeVersionOk()));
    results.push(check("cmux installed", commandExists("cmux")));
    results.push(check("Obsidian installed", commandExists("obsidian") || fs.existsSync("/Applications/Obsidian.app")));
    results.push(check("Node.js >= 18", nodeVersionOk()));
    results.push(
      check(
        "Agent Teams enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)",
        settingsHaveAgentTeams(),
      ),
    );
    results.push(check("Plugin: superpowers", pluginInstalled("superpowers")));
    results.push(
      check("Plugin: claude-mem", pluginInstalled("claude-mem")),
    );
    results.push(check("Plugin: context7", pluginInstalled("context7")));

    const config = loadConfig();
    results.push(
      check(
        "Cockpit config exists",
        fs.existsSync(
          process.env.COCKPIT_CONFIG ||
            `${process.env.HOME}/.config/cockpit/config.json`,
        ),
      ),
    );
    results.push(
      check(
        `Hub vault exists (${config.hubVault})`,
        fs.existsSync(config.hubVault),
      ),
    );

    const passed = results.filter(Boolean).length;
    const total = results.length;

    console.log(
      `\n${passed === total ? chalk.green("All checks passed") : chalk.yellow(`${passed}/${total} checks passed`)}\n`,
    );

    if (results.some((r) => !r)) {
      process.exit(1);
    }
  });
