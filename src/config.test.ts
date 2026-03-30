// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDefaultConfig, loadConfig, saveConfig } from "./config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("config", () => {
  const tmpDir = path.join(os.tmpdir(), "cockpit-test-" + Date.now());
  const configPath = path.join(tmpDir, "config.json");

  beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("returns default config", () => {
    const config = getDefaultConfig();
    expect(config.commandName).toBe("command");
    expect(config.projects).toEqual({});
    expect(config.defaults.maxCrew).toBe(5);
    expect(config.defaults.worktreeDir).toBe(".worktrees");
    expect(config.defaults.teammateMode).toBe("in-process");
    expect(config.metrics.enabled).toBe(true);
  });

  it("saves and loads config", () => {
    const config = getDefaultConfig();
    config.projects.brove = {
      path: "/tmp/brove",
      captainName: "brove-captain",
      spokeVault: "/tmp/brove/.cockpit-vault",
      host: "local",
    };
    saveConfig(config, configPath);
    const loaded = loadConfig(configPath);
    expect(loaded.projects.brove.path).toBe("/tmp/brove");
    expect(loaded.projects.brove.captainName).toBe("brove-captain");
  });

  it("returns default config when file does not exist", () => {
    const loaded = loadConfig(path.join(tmpDir, "nonexistent.json"));
    expect(loaded.commandName).toBe("command");
  });
});
