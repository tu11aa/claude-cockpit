// src/control/telegram/index.ts
export { createTelegramClient } from "./client.js";
export type { TelegramClient, TgUpdate } from "./client.js";
export { createTelegramSubsystem, processInboundUpdate } from "./subsystem.js";
export type { TelegramSubsystem } from "./subsystem.js";
export { loadTelegramState } from "./state.js";
