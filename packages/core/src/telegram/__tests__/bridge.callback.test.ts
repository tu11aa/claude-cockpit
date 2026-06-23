import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TelegramConfig } from "@squadrant/shared";
import { loadProjectOverride } from "@squadrant/shared";
import { createTelegramBridge, type TelegramBridge } from "../bridge.js";
import type { TelegramClient } from "../client.js";
import { setTopic, isNotifyActive } from "../state.js";

const USER = 42;
const CHAT = -100111;
const cfg: TelegramConfig = {
  botToken: "T", supergroupId: -100500, chats: [CHAT], pollMs: 1,
  remoteControl: true, users: [USER],
} as any; // stale dist types lack remoteControl/users

function freshRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sq-tg-cb-"));
}

async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 2));
  }
}

let active: TelegramBridge | null = null;
afterEach(() => {
  active?.stop();
  active = null;
});

interface Harness {
  bridge: TelegramBridge;
  client: TelegramClient & { answerCallbackQuery: ReturnType<typeof vi.fn>; editMessageReplyMarkup: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> };
  runCommand: ReturnType<typeof vi.fn>;
  stateRoot: string;
  configRoot: string;
}

function makeHarness(callbackQuery: unknown, overrideCfg = cfg): Harness {
  const stateRoot = freshRoot();
  const configRoot = freshRoot();
  let n = 0;
  const answerCallbackQuery = vi.fn(async () => {});
  const editMessageReplyMarkup = vi.fn(async () => {});
  const sendMessage = vi.fn(async () => {});
  const client = {
    sendMessage,
    answerCallbackQuery,
    editMessageReplyMarkup,
    createForumTopic: async () => 1,
    getMe: async () => ({ id: 0, username: "" }),
    setMyCommands: async () => {},
    getUpdates: async () => {
      n++;
      if (n === 1) return [{ update_id: 10, callback_query: callbackQuery } as never];
      return [];
    },
  } as unknown as Harness["client"];
  const runCommand = vi.fn(async () => "ok");
  const bridge = createTelegramBridge({
    cfg: overrideCfg, stateRoot, configRoot, client,
    appendCaptainMessage: async () => {},
    log: () => {},
    runCommand,
    sendReply: async () => {},
  });
  active = bridge;
  return { bridge, client, runCommand, stateRoot, configRoot };
}

describe("handleCallback — notify", () => {
  it("authorized crew tap writes the override, answers, and edits the panel", async () => {
    const h = makeHarness({
      id: "c1", from: { id: USER }, data: "n:crew:none",
      message: { chat: { id: CHAT }, message_id: 42, message_thread_id: 9 },
    });
    setTopic(h.stateRoot, "squadrant", 9);
    h.bridge.start();
    await waitFor(() => h.client.answerCallbackQuery.mock.calls.length > 0);

    expect(loadProjectOverride("squadrant", h.configRoot).telegram?.notify?.crew).toBe("none");
    expect(h.client.answerCallbackQuery).toHaveBeenCalledWith("c1", expect.stringContaining("crew = none"));
    expect(h.client.editMessageReplyMarkup).toHaveBeenCalledTimes(1);
  });

  it("active tap mutes via live state", async () => {
    const h = makeHarness({
      id: "c4", from: { id: USER }, data: "n:active:off",
      message: { chat: { id: CHAT }, message_id: 1, message_thread_id: 9 },
    });
    setTopic(h.stateRoot, "squadrant", 9);
    h.bridge.start();
    await waitFor(() => h.client.answerCallbackQuery.mock.calls.length > 0);
    expect(isNotifyActive(h.stateRoot, "squadrant")).toBe(false);
  });
});

describe("handleCallback — auth gate", () => {
  it("unauthorized tap answers not-authorized and does NOT apply or edit", async () => {
    const h = makeHarness({
      id: "c2", from: { id: 999 }, data: "n:crew:all",
      message: { chat: { id: CHAT }, message_id: 1, message_thread_id: 9 },
    });
    setTopic(h.stateRoot, "squadrant", 9);
    h.bridge.start();
    await waitFor(() => h.client.answerCallbackQuery.mock.calls.length > 0);

    expect(h.client.answerCallbackQuery).toHaveBeenCalledWith("c2", expect.stringContaining("not authorized"));
    expect(h.client.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(loadProjectOverride("squadrant", h.configRoot).telegram?.notify?.crew).toBeUndefined();
  });
});

describe("handleCallback — effort", () => {
  it("runs the effort command and answers", async () => {
    const h = makeHarness({
      id: "c3", from: { id: USER }, data: "e:low",
      message: { chat: { id: CHAT }, message_id: 7 },
    });
    h.bridge.start();
    await waitFor(() => h.client.answerCallbackQuery.mock.calls.length > 0);
    expect(h.runCommand).toHaveBeenCalledWith(["effort", "low"]);
    expect(h.client.answerCallbackQuery).toHaveBeenCalledWith("c3", expect.stringContaining("effort = low"));
  });
});

describe("handleCallback — pickers", () => {
  it("mute pick mutes the project via live state", async () => {
    const h = makeHarness({
      id: "c5", from: { id: USER }, data: "mu:brove",
      message: { chat: { id: CHAT }, message_id: 3 },
    });
    h.bridge.start();
    await waitFor(() => h.client.answerCallbackQuery.mock.calls.length > 0);
    expect(isNotifyActive(h.stateRoot, "brove")).toBe(false);
    expect(h.client.answerCallbackQuery).toHaveBeenCalledWith("c5", expect.stringContaining("muted brove"));
  });

  it("launch pick runs the launch command", async () => {
    const h = makeHarness({
      id: "c6", from: { id: USER }, data: "lc:solder",
      message: { chat: { id: CHAT }, message_id: 4 },
    });
    h.bridge.start();
    await waitFor(() => h.client.answerCallbackQuery.mock.calls.length > 0);
    expect(h.runCommand).toHaveBeenCalledWith(["launch", "solder"]);
  });
});
