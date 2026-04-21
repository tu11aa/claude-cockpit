import { describe, it, expect, vi } from "vitest";
import { TrackerRegistry } from "../registry.js";
import type { TrackerDriver, TrackerScope } from "../types.js";
import type { CockpitConfig, ReactionsConfig } from "../../config.js";

function stubFactory(name: string): (scope: TrackerScope) => TrackerDriver {
  return (scope) => ({
    name,
    probe: vi.fn(async () => ({ installed: true, authenticated: true })),
    listIssues: vi.fn(async () => []),
    createIssue: vi.fn(async () => ({ number: 0, url: `${name}:${scope.owner}/${scope.repo}` })),
    listPullRequests: vi.fn(async () => []),
    getPullRequestChecks: vi.fn(async () => []),
    getPullRequestReviewDecision: vi.fn(async () => "none" as const),
    getRunLog: vi.fn(async () => ""),
    mergePullRequest: vi.fn(async () => {}),
  });
}

function baseConfig(overrides: Partial<CockpitConfig> = {}): CockpitConfig {
  return {
    commandName: "cmd",
    hubVault: "~/hub",
    projects: {},
    defaults: {
      maxCrew: 5,
      worktreeDir: ".worktrees",
      teammateMode: "in-process",
      permissions: { command: "default", captain: "acceptEdits" },
    },
    metrics: { enabled: false, path: "" },
    ...overrides,
  };
}

function baseReactions(overrides: Partial<ReactionsConfig> = {}): ReactionsConfig {
  return {
    engine: { poll_interval: "5m", state_file: "", max_retries: 2 },
    github: { repos: {} },
    reactions: {},
    ...overrides,
  };
}

describe("TrackerRegistry", () => {
  it("returns github driver by default", () => {
    const registry = new TrackerRegistry({ github: stubFactory("github") });
    const config = baseConfig({
      projects: { brove: { path: "/p", captainName: "c", spokeVault: "~/s", host: "local" } },
    });
    const reactions = baseReactions({ github: { repos: { brove: { owner: "tu11aa", repo: "brove" } } } });
    const driver = registry.forProject("brove", config, reactions);
    expect(driver.name).toBe("github");
  });

  it("uses top-level tracker override", () => {
    const registry = new TrackerRegistry({
      github: stubFactory("github"),
      linear: stubFactory("linear"),
    });
    const config = baseConfig({
      tracker: "linear",
      projects: { brove: { path: "/p", captainName: "c", spokeVault: "~/s", host: "local" } },
    });
    const reactions = baseReactions();
    const driver = registry.forProject("brove", config, reactions);
    expect(driver.name).toBe("linear");
  });

  it("project-level tracker overrides top-level", () => {
    const registry = new TrackerRegistry({
      github: stubFactory("github"),
      linear: stubFactory("linear"),
      jira: stubFactory("jira"),
    });
    const config = baseConfig({
      tracker: "linear",
      projects: {
        brove: { path: "/p", captainName: "c", spokeVault: "~/s", host: "local", tracker: "jira" },
      },
    });
    const reactions = baseReactions();
    const driver = registry.forProject("brove", config, reactions);
    expect(driver.name).toBe("jira");
  });

  it("throws when configured provider has no factory", () => {
    const registry = new TrackerRegistry({ github: stubFactory("github") });
    const config = baseConfig({
      tracker: "unknown",
      projects: { brove: { path: "/p", captainName: "c", spokeVault: "~/s", host: "local" } },
    });
    const reactions = baseReactions();
    expect(() => registry.forProject("brove", config, reactions)).toThrowError(/unknown/i);
  });

  it("throws for unknown project", () => {
    const registry = new TrackerRegistry({ github: stubFactory("github") });
    expect(() => registry.forProject("nope", baseConfig(), baseReactions())).toThrowError(/not found/i);
  });

  it("passes owner/repo from reactions.json into factory scope", async () => {
    const registry = new TrackerRegistry({ github: stubFactory("github") });
    const config = baseConfig({
      projects: { brove: { path: "/p", captainName: "c", spokeVault: "~/s", host: "local" } },
    });
    const reactions = baseReactions({
      github: { repos: { brove: { owner: "tu11aa", repo: "claude-cockpit" } } },
    });
    const driver = registry.forProject("brove", config, reactions);
    const result = await driver.createIssue({ title: "", body: "" });
    expect(result.url).toBe("github:tu11aa/claude-cockpit");
  });

  it("probeAll returns results keyed by provider", async () => {
    const registry = new TrackerRegistry({
      github: stubFactory("github"),
      linear: stubFactory("linear"),
    });
    const results = await registry.probeAll();
    expect(results.github.installed).toBe(true);
    expect(results.linear.installed).toBe(true);
  });
});
