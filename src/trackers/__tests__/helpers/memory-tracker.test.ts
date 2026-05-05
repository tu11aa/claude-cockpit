import { describe, it, expect } from "vitest";
import { createMemoryTrackerDriver } from "./memory-tracker.js";

describe("createMemoryTrackerDriver", () => {
  it("createIssue → listIssues round-trips", async () => {
    const d = createMemoryTrackerDriver();
    const r = await d.createIssue({ title: "t", body: "b", labels: ["bug"] });
    expect(r.number).toBe(1);
    const list = await d.listIssues({});
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("t");
  });

  it("listIssues filters by label intersection", async () => {
    const d = createMemoryTrackerDriver();
    await d.createIssue({ title: "a", body: "", labels: ["bug"] });
    await d.createIssue({ title: "b", body: "", labels: ["bug", "P1"] });
    expect(await d.listIssues({ labels: ["P1"] })).toHaveLength(1);
  });

  it("mergePullRequest updates state to merged", async () => {
    const d = createMemoryTrackerDriver({
      prs: [{ number: 1, title: "", body: "", labels: [], state: "open", headSha: "", url: "", updatedAt: "" }],
    });
    await d.mergePullRequest(1, "squash");
    const prs = await d.listPullRequests({ state: "all" });
    expect(prs[0].state).toBe("merged");
  });
});
