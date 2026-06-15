// src/commands/telegram.ts
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig, type CockpitConfig } from "../config.js";
import { createTelegramClient, type TgUpdate } from "../control/telegram/index.js";

/** Pure: the chat_id of the most recent my_chat_member update (bot added to a group). */
export function resolveLinkChatId(updates: TgUpdate[]): number | undefined {
  for (let i = updates.length - 1; i >= 0; i--) {
    const m = updates[i].my_chat_member;
    if (m) return m.chat.id;
  }
  return undefined;
}

/** Pure: render `telegram status`. */
export function buildStatusReport(args: { tokenValid: boolean; chats: Record<string, number> }): string {
  const lines = [`token: ${args.tokenValid ? "valid" : "invalid/unset"}`];
  const entries = Object.entries(args.chats);
  if (entries.length === 0) lines.push("no projects linked");
  else for (const [project, id] of entries) lines.push(`  ${project} → ${id}`);
  return lines.join("\n");
}

async function runLink(project: string, configPath?: string): Promise<number> {
  const config: CockpitConfig = loadConfig(configPath);
  if (!config.telegram?.botToken) {
    console.error(chalk.red("telegram link: set telegram.botToken in ~/.config/cockpit/config.json first"));
    return 1;
  }
  if (!config.projects[project]) {
    console.error(chalk.red(`telegram link: unknown project '${project}'`));
    return 1;
  }
  const client = createTelegramClient(config.telegram.botToken);
  const updates = await client.getUpdates(0, 0);
  const chatId = resolveLinkChatId(updates);
  if (chatId === undefined) {
    console.error(chalk.yellow("telegram link: no group found. Add the bot to your project supergroup (as admin), then re-run."));
    return 1;
  }
  config.telegram.chats = { ...config.telegram.chats, [project]: chatId };
  saveConfig(config, configPath);
  console.log(chalk.green(`✔ linked '${project}' → chat ${chatId}`));
  return 0;
}

async function runStatus(configPath?: string): Promise<number> {
  const config = loadConfig(configPath);
  let tokenValid = false;
  if (config.telegram?.botToken) {
    try {
      await createTelegramClient(config.telegram.botToken).getMe();
      tokenValid = true;
    } catch { tokenValid = false; }
  }
  console.log(buildStatusReport({ tokenValid, chats: config.telegram?.chats ?? {} }));
  return 0;
}

export const telegramCommand = new Command("telegram")
  .description("Configure Telegram remote control (#65)")
  .addCommand(
    new Command("link")
      .description("Bind a project to the supergroup the bot was added to")
      .argument("<project>", "project to link")
      .action(async (project: string) => process.exit(await runLink(project))),
  )
  .addCommand(
    new Command("status")
      .description("Show token validity and linked projects")
      .action(async () => process.exit(await runStatus())),
  );
