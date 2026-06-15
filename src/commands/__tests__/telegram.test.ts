// src/commands/__tests__/telegram.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveLinkChatId, buildStatusReport } from "../telegram.js";
import type { TgUpdate } from "../../control/telegram/client.js";

describe("telegram link", () => {
  it("picks the chat_id from the most recent my_chat_member where the bot became admin/member", () => {
    const updates: TgUpdate[] = [
      { update_id: 1, my_chat_member: { chat: { id: -100, type: "supergroup", title: "cockpit" }, new_chat_member: { status: "administrator" } } },
      { update_id: 2, message: { chat: { id: -100, type: "supergroup" }, text: "hi" } },
    ];
    expect(resolveLinkChatId(updates)).toBe(-100);
  });

  it("returns undefined when no my_chat_member update is present", () => {
    expect(resolveLinkChatId([{ update_id: 1, message: { chat: { id: -100, type: "supergroup" }, text: "hi" } }])).toBeUndefined();
  });
});

describe("telegram status", () => {
  it("reports linked projects and token validity", () => {
    const report = buildStatusReport({ tokenValid: true, chats: { cockpit: -100, brove: -200 } });
    expect(report).toContain("token: valid");
    expect(report).toContain("cockpit");
    expect(report).toContain("-100");
    expect(report).toContain("brove");
  });

  it("reports when telegram is not configured", () => {
    expect(buildStatusReport({ tokenValid: false, chats: {} })).toContain("no projects linked");
  });
});
