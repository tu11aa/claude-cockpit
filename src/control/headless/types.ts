// src/control/headless/types.ts
export interface HeadlessResult {
  outcome: "done" | "failed";
  payload?: string;       // extracted result text → becomes resultRef contents
  sessionId?: string;
  error?: string;
  exitCode?: number;
  parseWarning?: boolean;
}

export interface HeadlessAdapter {
  provider: string;
  buildCommand(task: string, sessionId?: string): string[];
  parseResult(stdout: string, exitCode: number): HeadlessResult;
}
