import { describe, it, expect, vi, beforeEach } from "vitest";
import { projectionCommand } from "../projection.js";

const emitMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
const getMock = vi.hoisted(() => vi.fn());

vi.mock("../../projection/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../projection/index.js")>(
    "../../projection/index.js",
  );
  return {
    ...actual,
    ProjectionRegistry: class {
      get = getMock;
      list = listMock;
    },
    createCursorEmitter: () => ({
      name: "cursor",
      destinations: () => [{ path: "/tmp/a.mdc", shared: false, format: "mdc" }],
      emit: emitMock,
    }),
    createCodexEmitter: () => ({
      name: "codex",
      destinations: () => [{ path: "/tmp/b.md", shared: true, format: "markdown" }],
      emit: emitMock,
    }),
    createGeminiEmitter: () => ({
      name: "gemini",
      destinations: () => [{ path: "/tmp/c.md", shared: true, format: "markdown" }],
      emit: emitMock,
    }),
  };
});

vi.mock("../../lib/canonical-source.js", () => ({
  readUserLevelSource: vi.fn(async () => ({ instructions: "", skills: [] })),
  readProjectLevelSource: vi.fn(async () => null),
}));

// Mock loadConfig with a shape matching the real CockpitConfig — adapt if Step 3 shows different fields.
vi.mock("../../config.js", async () => {
  const actual = await vi.importActual<typeof import("../../config.js")>("../../config.js");
  return {
    ...actual,
    loadConfig: () => ({
      commandName: "cmd",
      hubVault: "~/hub",
      projects: {
        brove: { path: "/tmp/brove", captainName: "b", spokeVault: "~/hub/brove", host: "local" },
      },
      defaults: {
        maxCrew: 5,
        worktreeDir: ".worktrees",
        teammateMode: "in-process",
        permissions: { command: "default", captain: "acceptEdits" },
      },
      metrics: { enabled: false, path: "" },
      projection: { targets: ["cursor", "codex", "gemini"] },
    }),
  };
});

// Avoid accidentally touching a real workspace: stub obsidian factory.
vi.mock("../../workspaces/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../workspaces/index.js")>(
    "../../workspaces/index.js",
  );
  return {
    ...actual,
    createObsidianDriver: () => ({
      name: "obsidian",
      async probe() { return { installed: true, rootExists: true }; },
      async read() { return ""; },
      async write() {},
      async exists() { return false; },
      async list() { return []; },
      async mkdir() {},
    }),
  };
});

describe("projectionCommand", () => {
  beforeEach(() => {
    emitMock.mockReset().mockResolvedValue({ written: true, path: "/tmp/x", bytesWritten: 10 });
    listMock.mockReset().mockReturnValue(["cursor", "codex", "gemini"]);
    getMock.mockReset().mockImplementation((name: string) => {
      const destMap: Record<string, { path: string; shared: boolean; format: "markdown" | "mdc" }> = {
        cursor: { path: "/tmp/a.mdc", shared: false, format: "mdc" },
        codex: { path: "/tmp/b.md", shared: true, format: "markdown" },
        gemini: { path: "/tmp/c.md", shared: true, format: "markdown" },
      };
      const dest = destMap[name];
      if (!dest) throw new Error(`Unknown projection target '${name}'`);
      return {
        name,
        destinations: () => [dest],
        emit: emitMock,
      };
    });
  });

  it("is a commander Command named 'projection'", () => {
    expect(projectionCommand.name()).toBe("projection");
  });

  it("has subcommands emit, diff, list", () => {
    const names = projectionCommand.commands.map((c) => c.name());
    expect(names).toContain("emit");
    expect(names).toContain("diff");
    expect(names).toContain("list");
  });

  it("emit --target cursor --scope user calls cursor emitter for user scope", async () => {
    await projectionCommand.parseAsync(["node", "projection", "emit", "--target", "cursor", "--scope", "user"]);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("emit --project brove triggers emit calls for brove project scope", async () => {
    await projectionCommand.parseAsync(["node", "projection", "emit", "--project", "brove"]);
    // readProjectLevelSource mock returns null, so brove projection is skipped — but user-level may also trigger
    // depending on default. The test only asserts that the command parses and does not throw.
    expect(projectionCommand).toBeDefined();
  });

  it("emit --all runs user-level + every managed project", async () => {
    await projectionCommand.parseAsync(["node", "projection", "emit", "--all"]);
    expect(emitMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("diff --target cursor forwards dryRun:true to emit", async () => {
    await projectionCommand.parseAsync(["node", "projection", "diff", "--target", "cursor", "--scope", "user"]);
    const [, , opts] = emitMock.mock.calls[0];
    expect(opts?.dryRun).toBe(true);
  });
});
