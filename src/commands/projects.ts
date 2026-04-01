import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  resolveHome,
  ProjectConfig,
} from "../config.js";

function findPackageRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (dir !== "/") {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const listCmd = new Command("list")
  .description("List registered projects")
  .action(() => {
    const config = loadConfig();
    const projects = Object.entries(config.projects);

    if (projects.length === 0) {
      console.log(chalk.yellow("\nNo projects registered. Use: cockpit projects add <name> <path>\n"));
      return;
    }

    console.log(chalk.bold("\nRegistered Projects\n"));
    console.log(
      chalk.dim(
        `  ${"NAME".padEnd(20)} ${"PATH".padEnd(45)} ${"CAPTAIN".padEnd(20)} SPOKE VAULT`,
      ),
    );
    console.log(chalk.dim("  " + "─".repeat(100)));

    for (const [name, project] of projects) {
      const spokeExists = fs.existsSync(project.spokeVault);
      const spokeStatus = spokeExists ? chalk.green("✔") : chalk.red("✘");
      console.log(
        `  ${name.padEnd(20)} ${project.path.padEnd(45)} ${project.captainName.padEnd(20)} ${spokeStatus} ${project.spokeVault}`,
      );
    }
    console.log("");
  });

const addCmd = new Command("add")
  .description("Register a project")
  .argument("<name>", "Project name")
  .argument("<path>", "Path to project directory")
  .option("--captain <name>", "Captain workspace name (default: <project>-captain)")
  .option("--spoke <path>", "Spoke vault path (default: ~/cockpit-hub/spokes/<name>)")
  .action((name: string, projectPath: string, opts: { captain?: string; spoke?: string }) => {
    const config = loadConfig();

    if (config.projects[name]) {
      console.log(chalk.yellow(`\n⚠ Project '${name}' already registered. Remove it first.\n`));
      process.exit(1);
    }

    const captainName = opts.captain || `${name}-captain`;

    // Validate captain name is unique across all projects
    const existingCaptains = Object.entries(config.projects)
      .map(([pName, p]) => ({ project: pName, captain: p.captainName }));
    const conflict = existingCaptains.find((c) => c.captain === captainName);
    if (conflict) {
      console.log(chalk.red(`\n  ✘ Captain name '${captainName}' already used by project '${conflict.project}'.`));
      console.log(chalk.dim(`  Use --captain <unique-name> to specify a different name.\n`));
      process.exit(1);
    }

    // Captain name must not collide with command workspace name
    if (captainName === (config.commandName || "command")) {
      console.log(chalk.red(`\n  ✘ Captain name '${captainName}' conflicts with the command workspace name.\n`));
      process.exit(1);
    }

    const resolvedPath = resolveHome(projectPath);
    const spokeVault = opts.spoke
      ? resolveHome(opts.spoke)
      : path.join(config.hubVault, "spokes", name);

    const project: ProjectConfig = {
      path: resolvedPath,
      captainName,
      spokeVault,
      host: "local",
    };

    config.projects[name] = project;
    saveConfig(config);
    console.log(chalk.green(`\n  ✔ Project '${name}' registered`));

    // Scaffold spoke vault from template
    const pkgRoot = findPackageRoot();
    const spokeTemplate = path.join(pkgRoot, "obsidian", "spoke");

    if (fs.existsSync(spokeVault)) {
      console.log(chalk.yellow(`  ⚠ Spoke vault already exists at ${spokeVault}, skipping scaffold`));
    } else if (fs.existsSync(spokeTemplate)) {
      copyDirRecursive(spokeTemplate, spokeVault);
      // Update project field in status.md frontmatter
      const statusPath = path.join(spokeVault, "status.md");
      if (fs.existsSync(statusPath)) {
        const content = fs.readFileSync(statusPath, "utf-8");
        const updated = content.replace(/^project: unnamed/m, `project: ${name}`);
        fs.writeFileSync(statusPath, updated);
      }
      console.log(chalk.green(`  ✔ Spoke vault scaffolded at ${spokeVault}`));
    } else {
      fs.mkdirSync(spokeVault, { recursive: true });
      console.log(chalk.yellow(`  ⚠ Spoke template not found; created empty dir at ${spokeVault}`));
    }

    console.log("");
  });

const removeCmd = new Command("remove")
  .description("Unregister a project (does not delete files)")
  .argument("<name>", "Project name")
  .action((name: string) => {
    const config = loadConfig();

    if (!config.projects[name]) {
      console.log(chalk.yellow(`\n⚠ Project '${name}' not found.\n`));
      process.exit(1);
    }

    delete config.projects[name];
    saveConfig(config);
    console.log(chalk.green(`\n  ✔ Project '${name}' removed from config (files untouched)\n`));
  });

export const projectsCommand = new Command("projects")
  .description("Manage registered projects")
  .addCommand(listCmd)
  .addCommand(addCmd)
  .addCommand(removeCmd);
