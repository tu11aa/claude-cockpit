// src/control/telegram/__tests__/subsystem.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTelegramSubsystem, processInboundUpdate } from "../subsystem.js";
import { loadTelegramState } from "../state.js";
import type { TelegramClient } from "../client.js";
import type { TaskRecord } from "../../types.js";

function fakeClient(over: Partial<TelegramClient> = {}): TelegramClient {
  return {
    getMe: vi.fn(async () => {}),
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(async () => {}),
    createForumTopic: vi.fn(async () => 42),
    closeForumTopic: vi.fn(async () => {}),
    ...over,
  };
}

function rec(over: Partial<TaskRecord> = {}): TaskRecord {
  return { id: "t1", project: "cockpit", name: "crew-1", provider: "claude", state: "working", mode: "interactive", task: "x", lastHeartbeat: 0, createdAt: 0, ...over } as TaskRecord;
}

const baseDeps = (client: TelegramClient, root: string) => ({
  client,
  chats: { cockpit: -100 },
  stateRoot: root,
  appendCaptainMessage: vi.fn(async () => 1),
  resolveCrewName: () => "crew-1",
  log: () => {},
});

describe("telegram subsystem — outbound", () => {
  it("creates a topic on first push and sends into it", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const client = fakeClient();
    const sub = await createTelegramSubsystem(baseDeps(client, root));
    await sub.pushLifecycle({ project: "cockpit", message: "CREW BLOCKED: ?", record: rec() });
    expect(client.createForumTopic).toHaveBeenCalledWith(-100, "🔧 crew-1");
    expect(client.sendMessage).toHaveBeenCalledWith(-100, "CREW BLOCKED: ?", 42);
  });

  it("reuses an existing topic on the second push (no second create)", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const client = fakeClient();
    const sub = await createTelegramSubsystem(baseDeps(client, root));
    await sub.pushLifecycle({ project: "cockpit", message: "a", record: rec() });
    await sub.pushLifecycle({ project: "cockpit", message: "b", record: rec() });
    expect(client.createForumTopic).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("no-ops for an unlinked project", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const client = fakeClient();
    const sub = await createTelegramSubsystem(baseDeps(client, root));
    await sub.pushLifecycle({ project: "brove", message: "x", record: rec({ project: "brove" }) });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("closes the topic after a terminal-state push", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const client = fakeClient();
    const sub = await createTelegramSubsystem(baseDeps(client, root));
    await sub.pushLifecycle({ project: "cockpit", message: "CREW DONE", record: rec({ state: "done" }) });
    expect(client.closeForumTopic).toHaveBeenCalledWith(-100, 42);
  });

  it("concurrent pushLifecycle for the same new task calls createForumTopic only once", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const client = fakeClient();
    const sub = await createTelegramSubsystem(baseDeps(client, root));
    await Promise.all([
      sub.pushLifecycle({ project: "cockpit", message: "a", record: rec() }),
      sub.pushLifecycle({ project: "cockpit", message: "b", record: rec() }),
    ]);
    expect(client.createForumTopic).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("never throws when the client fails (best-effort)", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const client = fakeClient({ sendMessage: vi.fn(async () => { throw new Error("network down"); }) });
    const sub = await createTelegramSubsystem(baseDeps(client, root));
    await expect(sub.pushLifecycle({ project: "cockpit", message: "x", record: rec() })).resolves.toBeUndefined();
  });
});

describe("telegram subsystem — inbound routing (pure)", () => {
  const chats = { cockpit: -100, brove: -200 };

  it("routes a crew-topic reply to that crew's captain via appendCaptainMessage", async () => {
    const append = vi.fn(async () => 1);
    const findTask = (_project: string, thread: number) => (thread === 42 ? { project: "cockpit", taskId: "t1" } : undefined);
    const handled = await processInboundUpdate({
      update: { update_id: 5, message: { chat: { id: -100, type: "supergroup" }, message_thread_id: 42, text: "use lucia" } },
      chats, findTask, resolveCrewName: () => "crew-2",
      appendCaptainMessage: append, stateRoot: "/tmp", log: () => {},
    });
    expect(handled).toBe(true);
    expect(append).toHaveBeenCalledWith({ stateRoot: "/tmp", project: "cockpit", message: "📩 [from Telegram · crew-2] use lucia", taskId: "t1", name: "crew-2" });
  });

  it("routes a general-topic reply to the captain (no task)", async () => {
    const append = vi.fn(async () => 1);
    await processInboundUpdate({
      update: { update_id: 6, message: { chat: { id: -100, type: "supergroup" }, text: "status?" } },
      chats, findTask: () => undefined, resolveCrewName: () => undefined,
      appendCaptainMessage: append, stateRoot: "/tmp", log: () => {},
    });
    expect(append).toHaveBeenCalledWith({ stateRoot: "/tmp", project: "cockpit", message: "📩 [from Telegram] status?", taskId: undefined, name: undefined });
  });

  it("ignores updates from a non-allowlisted chat", async () => {
    const append = vi.fn(async () => 1);
    const handled = await processInboundUpdate({
      update: { update_id: 7, message: { chat: { id: -999, type: "supergroup" }, text: "rm -rf" } },
      chats, findTask: () => undefined, resolveCrewName: () => undefined,
      appendCaptainMessage: append, stateRoot: "/tmp", log: () => {},
    });
    expect(handled).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });

  it("inbound loop advances offset past a poisoned update whose appendCaptainMessage throws", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-"));
    const poison = { update_id: 5, message: { chat: { id: -100, type: "supergroup" }, text: "hi" } };
    const getUpdates = vi.fn()
      .mockResolvedValueOnce([poison])
      // Slow subsequent polls to prevent tight looping; test completes before this resolves.
      .mockImplementation(() => new Promise<[]>((r) => setTimeout(() => r([]), 5000)));
    const appendCaptainMessage = vi.fn()
      .mockRejectedValueOnce(new Error("mailbox locked"))
      .mockResolvedValue(1);
    const client = fakeClient({ getUpdates });
    const sub = await createTelegramSubsystem({ ...baseDeps(client, root), appendCaptainMessage });
    sub.startInbound();
    // Let the loop process one batch (first getUpdates returns [poison])
    await new Promise((resolve) => setTimeout(resolve, 30));
    sub.stop();
    // Offset must have advanced to 6 (poison_id+1) despite the throw
    const state = await loadTelegramState(root);
    expect(state.offset()).toBe(6);
  });

  it("ignores updates with no text (e.g. join events)", async () => {
    const append = vi.fn(async () => 1);
    const handled = await processInboundUpdate({
      update: { update_id: 8, message: { chat: { id: -100, type: "supergroup" } } },
      chats, findTask: () => undefined, resolveCrewName: () => undefined,
      appendCaptainMessage: append, stateRoot: "/tmp", log: () => {},
    });
    expect(handled).toBe(false);
    expect(append).not.toHaveBeenCalled();
  });
});
