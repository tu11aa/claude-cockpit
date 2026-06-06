import { describe, it, expect } from "vitest";
import { detectDrift } from "../config-drift.js";
import { getDefaultConfig } from "../../config.js";

function userConfig() {
  const c = getDefaultConfig();
  c.projects = { brove: { path: "/p", captainName: "x", spokeVault: "/v", host: "local" } };
  c.hubVault = "/Users/me/cockpit-hub";
  c.commandName = "\u{1F3DB}\u{FE0F} command";
  return c;
}

describe("detectDrift \u2014 missing", () => {
  it("flags a managed default key absent from user config", () => {
    const u = userConfig();
    delete (u.defaults as any).worktreeDir;
    const items = detectDrift(u, getDefaultConfig());
    const paths = items.filter((i) => i.kind === "missing").map((i) => i.path);
    expect(paths).toContain("defaults.worktreeDir");
  });

  it("does NOT flag user-data sections as drift", () => {
    const u = userConfig();
    const items = detectDrift(u, getDefaultConfig());
    const paths = items.map((i) => i.path);
    expect(paths.some((p) => p.startsWith("projects"))).toBe(false);
    expect(paths).not.toContain("hubVault");
    expect(paths).not.toContain("commandName");
  });
});

describe("detectDrift \u2014 deprecated", () => {
  it("flags a known-deprecated key present in user config", () => {
    const u = userConfig();
    (u.defaults as any).models = { command: "opus", captain: "opus", crew: "opus", exploration: "haiku", review: "opus" };
    (u.defaults as any).roles = getDefaultConfig().defaults.roles;
    const items = detectDrift(u, getDefaultConfig());
    const dep = items.find((i) => i.kind === "deprecated" && i.path === "defaults.models");
    expect(dep).toBeDefined();
  });

  it("does NOT flag an unknown key it has no opinion about", () => {
    const u = userConfig();
    (u as any).someFutureKey = { a: 1 };
    const items = detectDrift(u, getDefaultConfig());
    expect(items.some((i) => i.path === "someFutureKey")).toBe(false);
  });
});
