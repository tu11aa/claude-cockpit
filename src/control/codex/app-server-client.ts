// src/control/codex/app-server-client.ts
// Typed JSON-RPC 2.0 client for `codex app-server` v2.
// Transport: stdio (newline-delimited JSON). See spec §3.
// Defensive parser per orca codex-fetcher.ts:160-164: ignore non-JSON lines.

import { EventEmitter } from "node:events";
import { spawn as nodeSpawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

type Child = ChildProcessByStdio<Writable, Readable, Readable>;

export interface AppServerClientOpts {
  /** Override for tests; defaults to spawning real `codex app-server`. */
  spawn?: () => Child;
  clientInfo?: { name: string; version: string };
}

export function _parseChunk(acc: { buf: string }, chunk: string): unknown[] {
  acc.buf += chunk;
  const out: unknown[] = [];
  let idx: number;
  while ((idx = acc.buf.indexOf("\n")) >= 0) {
    const line = acc.buf.slice(0, idx);
    acc.buf = acc.buf.slice(idx + 1);
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip non-JSON defensively */ }
  }
  return out;
}

export class AppServerClient extends EventEmitter {
  private proc?: Child;
  private acc = { buf: "" };
  private opts: AppServerClientOpts;
  constructor(opts: AppServerClientOpts = {}) { super(); this.opts = opts; }

  start(): void {
    if (this.proc) throw new Error("AppServerClient already started");
    const sp = this.opts.spawn ?? defaultSpawn;
    this.proc = sp();
    this.proc.stdout.on("data", (d: Buffer | string) => this._onStdout(d.toString()));
    this.proc.stderr.on("data", (d: Buffer | string) => this.emit("stderr", d.toString()));
    this.proc.on("exit", (code, signal) => this.emit("closed", { code, signal }));
    this.proc.on("error", (e) => this.emit("error", e));
  }

  kill(): void {
    if (this.proc) this.proc.kill();
  }

  private _onStdout(s: string): void {
    for (const msg of _parseChunk(this.acc, s)) this._dispatch(msg);
  }

  // Filled in Task 1.4+.
  private _dispatch(_msg: unknown): void { /* noop until pending-map lands */ }
}

function defaultSpawn(): Child {
  return nodeSpawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] }) as Child;
}
