import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGitHubDriver } from "../github.js";

const execMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execSync: execMock,
}));

describe("GitHubDriver", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("has name 'github'", () => {
    const driver = createGitHubDriver({ owner: "tu11aa", repo: "claude-cockpit" });
    expect(driver.name).toBe("github");
  });

  it("throws when scope.owner or scope.repo missing", () => {
    expect(() => createGitHubDriver({})).toThrow(/owner/i);
    expect(() => createGitHubDriver({ owner: "x" })).toThrow(/repo/i);
  });

  it("probe returns installed=true and authenticated=true when gh responds", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("gh --version")) return "gh version 2.40.0";
      if (cmd.includes("gh auth status")) return "Logged in";
      return "";
    });
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const probe = await driver.probe();
    expect(probe.installed).toBe(true);
    expect(probe.authenticated).toBe(true);
  });

  it("probe returns installed=false when gh not found", async () => {
    execMock.mockImplementation(() => { throw new Error("gh: command not found"); });
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const probe = await driver.probe();
    expect(probe.installed).toBe(false);
    expect(probe.authenticated).toBe(false);
  });

  it("listIssues parses gh api output", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("gh api")) {
        return JSON.stringify([
          {
            number: 1,
            title: "first",
            body: "body1",
            labels: [{ name: "bug" }, { name: "P1" }],
            state: "open",
            assignees: [{ login: "alice" }],
            html_url: "https://github.com/o/r/issues/1",
            updated_at: "2026-04-21T10:00:00Z",
            pull_request: undefined,
          },
        ]);
      }
      return "";
    });
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const issues = await driver.listIssues({ state: "open" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      number: 1,
      title: "first",
      body: "body1",
      labels: ["bug", "P1"],
      state: "open",
      assignees: ["alice"],
      url: "https://github.com/o/r/issues/1",
      updatedAt: "2026-04-21T10:00:00Z",
    });
  });

  it("listIssues filters out pull_requests (gh api returns both on issues endpoint)", async () => {
    execMock.mockImplementation(() => JSON.stringify([
      { number: 1, title: "i", body: "", labels: [], state: "open", assignees: [], html_url: "", updated_at: "", pull_request: undefined },
      { number: 2, title: "p", body: "", labels: [], state: "open", assignees: [], html_url: "", updated_at: "", pull_request: { url: "..." } },
    ]));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const issues = await driver.listIssues({});
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("listIssues respects `assigned: false` (unassigned-only)", async () => {
    execMock.mockImplementation(() => JSON.stringify([
      { number: 1, title: "a", body: "", labels: [], state: "open", assignees: [{ login: "x" }], html_url: "", updated_at: "", pull_request: undefined },
      { number: 2, title: "b", body: "", labels: [], state: "open", assignees: [], html_url: "", updated_at: "", pull_request: undefined },
    ]));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const unassigned = await driver.listIssues({ assigned: false });
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].number).toBe(2);
  });

  it("createIssue calls gh issue create and parses the returned URL", async () => {
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("gh issue create")) return "https://github.com/o/r/issues/42\n";
      return "";
    });
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const result = await driver.createIssue({ title: "t", body: "b", labels: ["bug"] });
    expect(result.number).toBe(42);
    expect(result.url).toBe("https://github.com/o/r/issues/42");
    const calls = execMock.mock.calls.map(c => c[0] as string);
    expect(calls.some(c => c.includes("gh issue create") && c.includes("--label") && c.includes("bug"))).toBe(true);
  });

  it("listPullRequests parses gh api output", async () => {
    execMock.mockImplementation(() => JSON.stringify([
      {
        number: 7,
        title: "pr",
        body: "",
        labels: [],
        state: "open",
        merged: false,
        head: { sha: "abc123" },
        html_url: "https://github.com/o/r/pull/7",
        updated_at: "2026-04-21T10:00:00Z",
      },
    ]));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const prs = await driver.listPullRequests({ state: "open" });
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(7);
    expect(prs[0].state).toBe("open");
    expect(prs[0].headSha).toBe("abc123");
  });

  it("listPullRequests reports merged state when merged=true", async () => {
    execMock.mockImplementation(() => JSON.stringify([
      { number: 7, title: "", body: "", labels: [], state: "closed", merged: true, head: { sha: "x" }, html_url: "", updated_at: "" },
    ]));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const prs = await driver.listPullRequests({ state: "all" });
    expect(prs[0].state).toBe("merged");
  });

  it("getPullRequestChecks parses gh pr checks --json output", async () => {
    execMock.mockImplementation(() => JSON.stringify([
      { name: "test", state: "SUCCESS", link: "https://x.com/runs/123" },
      { name: "lint", state: "FAILURE", link: "https://x.com/runs/456" },
      { name: "deploy", state: "PENDING", link: "" },
    ]));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const checks = await driver.getPullRequestChecks(7);
    expect(checks).toEqual([
      { name: "test", state: "success", link: "https://x.com/runs/123", runId: "123" },
      { name: "lint", state: "failure", link: "https://x.com/runs/456", runId: "456" },
      { name: "deploy", state: "pending", link: "", runId: undefined },
    ]);
  });

  it("getPullRequestReviewDecision returns lowercase decision", async () => {
    execMock.mockImplementation(() => JSON.stringify({ reviewDecision: "APPROVED" }));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    expect(await driver.getPullRequestReviewDecision(7)).toBe("approved");
  });

  it("getPullRequestReviewDecision maps empty/null to 'none'", async () => {
    execMock.mockImplementation(() => JSON.stringify({ reviewDecision: "" }));
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    expect(await driver.getPullRequestReviewDecision(7)).toBe("none");
  });

  it("getRunLog returns --log-failed output, tailed to N lines", async () => {
    const bigLog = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes("gh run view") && cmd.includes("--log-failed")) return bigLog;
      return "";
    });
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    const log = await driver.getRunLog("123", { tail: 5 });
    expect(log.split("\n")).toHaveLength(5);
    expect(log).toContain("line 200");
    expect(log).toContain("line 196");
  });

  it("mergePullRequest calls gh pr merge with the method and --auto", async () => {
    execMock.mockReturnValue("");
    const driver = createGitHubDriver({ owner: "o", repo: "r" });
    await driver.mergePullRequest(7, "squash");
    const calls = execMock.mock.calls.map(c => c[0] as string);
    expect(calls[0]).toContain("gh pr merge 7");
    expect(calls[0]).toContain("--squash");
    expect(calls[0]).toContain("--auto");
  });
});
