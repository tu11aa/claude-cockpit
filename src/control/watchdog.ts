// src/control/watchdog.ts
import type { TaskRecord } from "./types.js";

/**
 * Pure. Returns a stalled record if a `working` task has exceeded its
 * heartbeat budget at time `now` (epoch ms), else null. No I/O, no clock.
 */
export function evaluateStall(rec: TaskRecord, now: number): TaskRecord | null {
  if (rec.state !== "working") return null;
  if (now - rec.lastHeartbeat <= rec.heartbeatBudgetMs) return null;
  return { ...rec, state: "stalled", lastEvent: "watchdog.stall" };
}
