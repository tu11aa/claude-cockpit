// src/control/daemon.ts
import type { Store } from "./store.js";
import type { ControlEvent, TaskRecord } from "./types.js";
import { reduce } from "./state-machine.js";

export interface DaemonDeps {
  store: Store;
  now: () => number;
  /** Injected in Task 14; resumes a blocked session. Optional until then. */
  deliverReply?: (rec: TaskRecord, message: string) => Promise<void>;
}

type Req =
  | { kind: "event"; project: string; event: ControlEvent }
  | { kind: "status"; project: string; id: string }
  | { kind: "list"; project: string }
  | { kind: "reply"; project: string; id: string; message: string };

export function createDaemon(deps: DaemonDeps) {
  const { store, now } = deps;
  return {
    async handle(req: Req): Promise<unknown> {
      switch (req.kind) {
        case "event": {
          const cur = store.get(req.project, req.event.id);
          if (!cur) throw new Error(`unknown task ${req.event.id}`);
          const next = reduce(cur, req.event, now());
          store.put(next);
          return next;
        }
        case "status": {
          const r = store.get(req.project, req.id);
          if (!r) throw new Error(`unknown task ${req.id}`);
          return r;
        }
        case "list":
          return store.list(req.project);
        case "reply": {
          const r = store.get(req.project, req.id);
          if (!r) throw new Error(`unknown task ${req.id}`);
          if (r.state !== "blocked") throw new Error(`task ${req.id} is not blocked (state=${r.state})`);
          if (deps.deliverReply) await deps.deliverReply(r, req.message);
          const next = reduce(r, { type: "task.started", id: r.id }, now());
          store.put(next);
          return next;
        }
      }
    },
  };
}
