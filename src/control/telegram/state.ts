// src/control/telegram/state.ts
import { promises as fs } from "node:fs";
import { join } from "node:path";

interface PersistShape {
  offset: number;
  topics: Record<string, number>; // `${project}::${taskId}` -> message_thread_id
}

export interface TelegramState {
  offset(): number;
  setOffset(n: number): Promise<void>;
  getTopic(project: string, taskId: string): number | undefined;
  setTopic(project: string, taskId: string, threadId: number): Promise<void>;
  findTask(threadId: number): { project: string; taskId: string } | undefined;
}

function statePath(stateRoot: string): string {
  return join(stateRoot, "telegram-state.json");
}

function key(project: string, taskId: string): string {
  return `${project}::${taskId}`;
}

export async function loadTelegramState(stateRoot: string): Promise<TelegramState> {
  let data: PersistShape = { offset: 0, topics: {} };
  try {
    data = JSON.parse(await fs.readFile(statePath(stateRoot), "utf-8")) as PersistShape;
    if (typeof data.offset !== "number") data.offset = 0;
    if (!data.topics) data.topics = {};
  } catch {
    // ENOENT / corrupt → start fresh
  }

  async function persist(): Promise<void> {
    await fs.mkdir(stateRoot, { recursive: true });
    const tmp = statePath(stateRoot) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data), "utf-8");
    await fs.rename(tmp, statePath(stateRoot));
  }

  return {
    offset: () => data.offset,
    async setOffset(n) {
      data.offset = n;
      await persist();
    },
    getTopic: (project, taskId) => data.topics[key(project, taskId)],
    async setTopic(project, taskId, threadId) {
      data.topics[key(project, taskId)] = threadId;
      await persist();
    },
    findTask(threadId) {
      for (const [k, v] of Object.entries(data.topics)) {
        if (v === threadId) {
          const sep = k.indexOf("::");
          return { project: k.slice(0, sep), taskId: k.slice(sep + 2) };
        }
      }
      return undefined;
    },
  };
}
