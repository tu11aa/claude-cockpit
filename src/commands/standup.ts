import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import chalk from "chalk";
import matter from "gray-matter";
import { loadConfig, resolveHome, type ProjectConfig } from "../config.js";

interface StatusFrontmatter {
  project?: string;
  captain_session?: string;
  last_updated?: string;
  active_crew?: number;
  tasks_total?: number;
  tasks_completed?: number;
  tasks_in_progress?: number;
  tasks_pending?: number;
}

interface DailyLogFrontmatter {
  date?: string;
  project?: string;
}

interface ProjectStandup {
  name: string;
  status: StatusFrontmatter;
  dailyLog: string | null;
  gitCommits: string[];
  blockers: string[];
}

function getDateStr(yesterday: boolean): string {
  const d = new Date();
  if (yesterday) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function readDailyLog(spokeVault: string, dateStr: string): { content: string; blockers: string[] } | null {
  const logFile = path.join(spokeVault, "daily-logs", `${dateStr}.md`);
  if (!fs.existsSync(logFile)) return null;

  const raw = fs.readFileSync(logFile, "utf-8");
  const { content } = matter(raw);

  // Extract blockers section
  const blockers: string[] = [];
  const blockerMatch = content.match(/## Blocked\n([\s\S]*?)(?=\n##|$)/);
  if (blockerMatch) {
    const lines = blockerMatch[1].trim().split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (trimmed && trimmed !== "(none)" && trimmed !== "None") {
        blockers.push(trimmed);
      }
    }
  }

  return { content, blockers };
}

function getGitCommits(projectPath: string, dateStr: string): string[] {
  const resolved = resolveHome(projectPath);
  if (!fs.existsSync(path.join(resolved, ".git"))) return [];

  try {
    const output = execSync(
      `git -C "${resolved}" log --since="${dateStr} 00:00:00" --until="${dateStr} 23:59:59" --oneline --no-merges 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();
    if (!output) return [];
    return output.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getProjectStandup(name: string, project: ProjectConfig, dateStr: string): ProjectStandup {
  const spokeVault = resolveHome(project.spokeVault);
  const statusFile = path.join(spokeVault, "status.md");

  let status: StatusFrontmatter = {};
  if (fs.existsSync(statusFile)) {
    try {
      status = matter(fs.readFileSync(statusFile, "utf-8")).data as StatusFrontmatter;
    } catch { /* empty */ }
  }

  const log = readDailyLog(spokeVault, dateStr);
  const gitCommits = getGitCommits(project.path, dateStr);

  return {
    name,
    status,
    dailyLog: log?.content ?? null,
    gitCommits,
    blockers: log?.blockers ?? [],
  };
}

function formatStandup(standups: ProjectStandup[], dateStr: string, raw: boolean): string {
  const lines: string[] = [];
  const header = `Standup — ${dateStr}`;

  if (!raw) {
    lines.push(chalk.bold(`\n${header}\n`));
  } else {
    lines.push(`# ${header}\n`);
  }

  let hasBlockers = false;

  for (const s of standups) {
    const tasksDone = s.status.tasks_completed ?? 0;
    const tasksTotal = s.status.tasks_total ?? 0;
    const tasksInProgress = s.status.tasks_in_progress ?? 0;

    if (!raw) {
      lines.push(chalk.cyan.bold(`## ${s.name}`));
    } else {
      lines.push(`## ${s.name}`);
    }

    // What was done
    if (s.gitCommits.length > 0 || tasksDone > 0) {
      lines.push(!raw ? chalk.green("Done:") : "**Done:**");
      for (const commit of s.gitCommits) {
        lines.push(`  - ${commit}`);
      }
      if (tasksDone > 0 && s.gitCommits.length === 0) {
        lines.push(`  - ${tasksDone}/${tasksTotal} tasks completed`);
      }
    }

    // In progress
    if (tasksInProgress > 0) {
      lines.push(!raw ? chalk.yellow("In Progress:") : "**In Progress:**");
      lines.push(`  - ${tasksInProgress} task(s) active`);
    }

    // Extract sections from daily log
    if (s.dailyLog) {
      const sections = ["Completed", "In Progress", "Tomorrow"];
      for (const section of sections) {
        const match = s.dailyLog.match(new RegExp(`## ${section}\\n([\\s\\S]*?)(?=\\n##|$)`));
        if (match) {
          const items = match[1].trim().split("\n").filter((l) => l.trim().startsWith("-"));
          if (items.length > 0 && section === "Tomorrow") {
            lines.push(!raw ? chalk.blue("Next:") : "**Next:**");
            for (const item of items) lines.push(`  ${item.trim()}`);
          }
        }
      }
    }

    // Blockers
    if (s.blockers.length > 0) {
      hasBlockers = true;
      lines.push(!raw ? chalk.red("Blocked:") : "**Blocked:**");
      for (const b of s.blockers) {
        lines.push(`  - ${b}`);
      }
    }

    // No activity
    if (s.gitCommits.length === 0 && tasksDone === 0 && !s.dailyLog) {
      lines.push(!raw ? chalk.dim("  (no activity)") : "  (no activity)");
    }

    lines.push("");
  }

  // Summary line
  const totalCommits = standups.reduce((sum, s) => sum + s.gitCommits.length, 0);
  const totalDone = standups.reduce((sum, s) => sum + (s.status.tasks_completed ?? 0), 0);

  if (!raw) {
    lines.push(chalk.dim(`--- ${totalCommits} commits, ${totalDone} tasks done${hasBlockers ? ", HAS BLOCKERS" : ""} ---\n`));
  } else {
    lines.push(`---\n*${totalCommits} commits, ${totalDone} tasks done${hasBlockers ? ", HAS BLOCKERS" : ""}*\n`);
  }

  return lines.join("\n");
}

export const standupCommand = new Command("standup")
  .description("Generate daily standup report from spoke vault data and git logs (zero tokens)")
  .option("-p, --project <name>", "Show standup for a specific project only")
  .option("-a, --all", "Show all projects (default)")
  .option("-y, --yesterday", "Show yesterday's standup instead of today")
  .option("-r, --raw", "Output raw markdown (for pasting into Slack/chat)")
  .action((opts) => {
    const config = loadConfig();
    const projects = Object.entries(config.projects);

    if (projects.length === 0) {
      console.log(chalk.yellow("\nNo projects registered. Use: cockpit projects add <name> <path>\n"));
      return;
    }

    const dateStr = getDateStr(!!opts.yesterday);
    const raw = !!opts.raw;

    let targets: [string, ProjectConfig][];
    if (opts.project) {
      const match = projects.find(([name]) => name === opts.project);
      if (!match) {
        console.error(chalk.red(`Project "${opts.project}" not found.`));
        process.exit(1);
      }
      targets = [match];
    } else {
      targets = projects;
    }

    const standups = targets.map(([name, proj]) => getProjectStandup(name, proj, dateStr));
    const output = formatStandup(standups, dateStr, raw);
    console.log(output);
  });
