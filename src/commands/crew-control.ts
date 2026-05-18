// src/commands/crew-control.ts
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { sendRequest } from "../control/protocol.js";
import { ensureDaemon } from "../control/launchd.js";
import type { Mode, Provider, TaskRecord } from "../control/types.js";

const SOCK = join(homedir(), ".config", "cockpit", "cockpit.sock");

export function buildDispatchRequest(o: {
  project: string; provider: Provider; mode: Mode; task: string; budgetMs?: number;
}): { kind: "dispatch"; record: TaskRecord } {
  const now = Date.now();
  return {
    kind: "dispatch",
    record: {
      id: randomUUID(), project: o.project, provider: o.provider, mode: o.mode,
      state: "submitted", task: o.task, createdAt: now, lastHeartbeat: now,
      lastEvent: "dispatch", heartbeatBudgetMs: o.budgetMs ?? 300000,
    },
  };
}

export function buildStatusRequest(project: string, id: string) {
  return { kind: "status" as const, project, id };
}

async function call(req: unknown): Promise<unknown> {
  try {
    return await sendRequest(SOCK, req);
  } catch {
    ensureDaemon(process.execPath, join(homedir(), ".config", "cockpit", "dist", "control", "cockpitd.js"));
    // one retry after kickstart; if still down, fail loud (no scrape fallback)
    return sendRequest(SOCK, req);
  }
}

export const crewControlCommand = new Command("crew")
  .description("Dispatch and track crew via the cockpit control plane");

crewControlCommand
  .command("dispatch <project> <task>")
  .requiredOption("--provider <p>", "claude|opencode|codex|gemini")
  .option("--mode <m>", "headless|interactive", "interactive")
  .action(async (project: string, task: string, opts: { provider: Provider; mode: Mode }) => {
    const req = buildDispatchRequest({ project, task, provider: opts.provider, mode: opts.mode });
    const r = await call(req);
    process.stdout.write(JSON.stringify(r) + "\n");
  });

crewControlCommand
  .command("status <project> <id>")
  .action(async (project: string, id: string) => {
    const r = await call(buildStatusRequest(project, id));
    process.stdout.write(JSON.stringify(r) + "\n");
  });

crewControlCommand
  .command("list <project>")
  .action(async (project: string) => {
    const r = await call({ kind: "list", project });
    process.stdout.write(JSON.stringify(r) + "\n");
  });

crewControlCommand
  .command("reply <project> <id> <message>")
  .action(async (project: string, id: string, message: string) => {
    const r = await call({ kind: "reply", project, id, message });
    process.stdout.write(JSON.stringify(r) + "\n");
  });

crewControlCommand
  .command("_hook <event>")
  .description("internal: invoked by injected agent hooks")
  .action(async (event: string) => {
    // hook payload arrives on stdin (Claude hook JSON); minimal: emit progress.
    process.stdout.write(`hook:${event}\n`);
  });
