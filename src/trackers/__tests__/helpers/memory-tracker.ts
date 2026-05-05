import type { CheckRun, Issue, PullRequest, ReviewDecision, TrackerDriver } from "../../types.js";

export interface MemoryTrackerState {
  issues: Issue[];
  prs: PullRequest[];
  checks: Record<number, CheckRun[]>;
  reviews: Record<number, ReviewDecision>;
  logs: Record<string, string>;
}

export function createMemoryTrackerDriver(initial?: Partial<MemoryTrackerState>): TrackerDriver & {
  state: MemoryTrackerState;
} {
  const state: MemoryTrackerState = {
    issues: initial?.issues ?? [],
    prs: initial?.prs ?? [],
    checks: initial?.checks ?? {},
    reviews: initial?.reviews ?? {},
    logs: initial?.logs ?? {},
  };

  return {
    name: "memory",
    state,

    async probe() {
      return { installed: true, authenticated: true };
    },

    async listIssues(filter) {
      return state.issues.filter((i) => {
        if (filter.state && i.state !== filter.state) return false;
        if (filter.labels && !filter.labels.every((l) => i.labels.includes(l))) return false;
        if (filter.assigned === true && i.assignees.length === 0) return false;
        if (filter.assigned === false && i.assignees.length > 0) return false;
        return true;
      });
    },

    async createIssue(input) {
      const number = state.issues.length + 1;
      const issue: Issue = {
        number,
        title: input.title,
        body: input.body,
        labels: input.labels ?? [],
        state: "open",
        assignees: [],
        url: `memory://issues/${number}`,
        updatedAt: new Date().toISOString(),
      };
      state.issues.push(issue);
      return { number, url: issue.url };
    },

    async listPullRequests(filter) {
      if (!filter.state || filter.state === "all") return state.prs;
      return state.prs.filter((p) => p.state === filter.state);
    },

    async getPullRequestChecks(number) {
      return state.checks[number] ?? [];
    },

    async getPullRequestReviewDecision(number) {
      return state.reviews[number] ?? "none";
    },

    async getRunLog(runId, options) {
      const log = state.logs[runId] ?? "";
      if (options?.tail === undefined) return log;
      const lines = log.split("\n");
      return lines.slice(Math.max(0, lines.length - options.tail)).join("\n");
    },

    async mergePullRequest(number) {
      const pr = state.prs.find((p) => p.number === number);
      if (pr) pr.state = "merged";
    },
  };
}
