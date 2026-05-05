import { describe, it, expect } from "vitest";
import { readUserLevelSource, readProjectLevelSource } from "../canonical-source.js";
import type { WorkspaceDriver } from "../../workspaces/types.js";

function memDriver(files: Record<string, string>): WorkspaceDriver {
  return {
    name: "memory",
    async probe() {
      return { installed: true, rootExists: true };
    },
    async read(p: string) {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    async write(p: string, c: string) {
      files[p] = c;
    },
    async exists(p: string) {
      if (p in files) return true;
      const prefix = p.endsWith("/") ? p : p + "/";
      return Object.keys(files).some((k) => k.startsWith(prefix));
    },
    async list(p: string) {
      const prefix = p.endsWith("/") ? p : p + "/";
      const entries = new Set<string>();
      for (const key of Object.keys(files)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          entries.add(rest.split("/")[0]);
        }
      }
      return Array.from(entries);
    },
    async mkdir() {},
  };
}

describe("canonical-source", () => {
  it("readUserLevelSource inlines every plugin/skills/*/SKILL.md", async () => {
    const driver = memDriver({
      "plugin/skills/karpathy-principles/SKILL.md":
        "---\nname: karpathy-principles\ndescription: K desc\n---\n\nK body",
      "plugin/skills/captain-ops/SKILL.md":
        "---\nname: captain-ops\ndescription: C desc\n---\n\nC body",
    });
    const src = await readUserLevelSource(driver);
    expect(src.skills.map((s) => s.name).sort()).toEqual(["captain-ops", "karpathy-principles"]);
    const k = src.skills.find((s) => s.name === "karpathy-principles")!;
    expect(k.description).toBe("K desc");
    expect(k.content).toContain("K body");
  });

  it("readUserLevelSource does NOT include cockpit's own AGENTS.md", async () => {
    const driver = memDriver({
      "AGENTS.md": "# Cockpit-specific content\ngitnexus stuff",
      "plugin/skills/karpathy-principles/SKILL.md":
        "---\nname: karpathy-principles\ndescription: K\n---\n\nK body",
    });
    const src = await readUserLevelSource(driver);
    expect(src.instructions).toBe("");
    expect(src.skills.map((s) => s.name)).toEqual(["karpathy-principles"]);
  });

  it("readUserLevelSource returns empty skills when plugin/skills is missing", async () => {
    const driver = memDriver({});
    const src = await readUserLevelSource(driver);
    expect(src.skills).toEqual([]);
    expect(src.instructions).toBe("");
  });

  it("readProjectLevelSource returns null when AGENTS.md is absent", async () => {
    const driver = memDriver({});
    const src = await readProjectLevelSource(driver, "/brove");
    expect(src).toBeNull();
  });

  it("readProjectLevelSource reads AGENTS.md when present", async () => {
    const driver = memDriver({
      "/brove/AGENTS.md": "# Brove rules\nuse design tokens",
    });
    const src = await readProjectLevelSource(driver, "/brove");
    expect(src).not.toBeNull();
    expect(src!.instructions).toContain("Brove rules");
  });

  it("readProjectLevelSource inlines project-local plugin/skills if present", async () => {
    const driver = memDriver({
      "/brove/AGENTS.md": "# Brove",
      "/brove/plugin/skills/brove-style/SKILL.md":
        "---\nname: brove-style\ndescription: BS\n---\n\nBS body",
    });
    const src = await readProjectLevelSource(driver, "/brove");
    expect(src!.skills.map((s) => s.name)).toEqual(["brove-style"]);
  });

  it("skips SKILL.md files with missing frontmatter", async () => {
    const driver = memDriver({
      "plugin/skills/broken/SKILL.md": "no frontmatter here\njust body",
    });
    const src = await readUserLevelSource(driver);
    expect(src.skills).toEqual([]);
  });
});
