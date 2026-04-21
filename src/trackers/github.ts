import { execSync } from "node:child_process";
import type {
  CheckRun,
  Issue,
  IssueFilter,
  PullRequest,
  ReviewDecision,
  TrackerDriver,
  TrackerProbeResult,
  TrackerScope,
} from "./types.js";

function gh(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8" }).trim();
}

function safeGh(args: string): string {
  try {
    return gh(args);
  } catch {
    return "";
  }
}

function escape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function parseLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => (typeof l === "string" ? l : l?.name)).filter((x): x is string => !!x);
}

function parseAssignees(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => (typeof a === "string" ? a : a?.login)).filter((x): x is string => !!x);
}

function extractRunId(link: string | undefined): string | undefined {
  if (!link) return undefined;
  const match = link.match(/\/runs\/(\d+)/);
  return match ? match[1] : undefined;
}

export function createGitHubDriver(scope: TrackerScope): TrackerDriver {
  const { owner, repo } = scope;
  if (typeof owner !== "string" || !owner) {
    throw new Error("GitHubDriver requires scope.owner (string)");
  }
  if (typeof repo !== "string" || !repo) {
    throw new Error("GitHubDriver requires scope.repo (string)");
  }
  const repoFlag = `--repo "${owner}/${repo}"`;

  return {
    name: "github",

    async probe(): Promise<TrackerProbeResult> {
      const version = safeGh("--version");
      const installed = !!version;
      const authenticated = installed && !!safeGh("auth status");
      return { installed, authenticated };
    },

    async listIssues(filter: IssueFilter): Promise<Issue[]> {
      const state = filter.state ?? "open";
      const raw = safeGh(`api "repos/${owner}/${repo}/issues?state=${state}&per_page=100"`);
      if (!raw) return [];
      let items: Array<Record<string, unknown>>;
      try {
        items = JSON.parse(raw);
      } catch {
        return [];
      }
      const issues: Issue[] = [];
      for (const item of items) {
        if (item.pull_request) continue;
        const labels = parseLabels(item.labels);
        if (filter.labels && filter.labels.length > 0) {
          if (!filter.labels.every((l) => labels.includes(l))) continue;
        }
        const assignees = parseAssignees(item.assignees);
        if (filter.assigned === true && assignees.length === 0) continue;
        if (filter.assigned === false && assignees.length > 0) continue;
        issues.push({
          number: Number(item.number),
          title: String(item.title ?? ""),
          body: String(item.body ?? ""),
          labels,
          state: (item.state === "closed" ? "closed" : "open") as "open" | "closed",
          assignees,
          url: String(item.html_url ?? ""),
          updatedAt: String(item.updated_at ?? ""),
        });
      }
      return issues;
    },

    async createIssue(input): Promise<{ number: number; url: string }> {
      const labelFlags = (input.labels ?? []).map((l) => `--label "${escape(l)}"`).join(" ");
      const output = gh(
        `issue create ${repoFlag} --title "${escape(input.title)}" --body "${escape(input.body)}" ${labelFlags}`.trim(),
      );
      const match = output.match(/\/issues\/(\d+)/);
      const number = match ? Number(match[1]) : 0;
      return { number, url: output.trim() };
    },

    async listPullRequests(filter): Promise<PullRequest[]> {
      const state = filter.state ?? "open";
      const raw = safeGh(`api "repos/${owner}/${repo}/pulls?state=${state}&per_page=100"`);
      if (!raw) return [];
      let items: Array<Record<string, unknown>>;
      try {
        items = JSON.parse(raw);
      } catch {
        return [];
      }
      return items.map((item) => {
        const merged = !!item.merged;
        const rawState = String(item.state ?? "open");
        const prState: "open" | "closed" | "merged" = merged
          ? "merged"
          : rawState === "closed"
          ? "closed"
          : "open";
        const head = (item.head as Record<string, unknown> | undefined) ?? {};
        return {
          number: Number(item.number),
          title: String(item.title ?? ""),
          body: String(item.body ?? ""),
          labels: parseLabels(item.labels),
          state: prState,
          headSha: String(head.sha ?? ""),
          url: String(item.html_url ?? ""),
          updatedAt: String(item.updated_at ?? ""),
        };
      });
    },

    async getPullRequestChecks(number: number): Promise<CheckRun[]> {
      const raw = safeGh(`pr checks ${number} ${repoFlag} --json name,state,link`);
      if (!raw) return [];
      let items: Array<Record<string, unknown>>;
      try {
        items = JSON.parse(raw);
      } catch {
        return [];
      }
      return items.map((item) => {
        const link = item.link ? String(item.link) : "";
        const rawState = String(item.state ?? "").toLowerCase();
        const state: CheckRun["state"] =
          rawState === "success" ? "success"
          : rawState === "failure" ? "failure"
          : rawState === "skipped" ? "skipped"
          : "pending";
        return {
          name: String(item.name ?? ""),
          state,
          link,
          runId: extractRunId(link),
        };
      });
    },

    async getPullRequestReviewDecision(number: number): Promise<ReviewDecision> {
      const raw = safeGh(`pr view ${number} ${repoFlag} --json reviewDecision`);
      if (!raw) return "none";
      try {
        const data = JSON.parse(raw) as { reviewDecision?: string };
        const decision = (data.reviewDecision ?? "").toLowerCase();
        if (decision === "approved") return "approved";
        if (decision === "changes_requested") return "changes_requested";
        if (decision === "review_required") return "review_required";
        return "none";
      } catch {
        return "none";
      }
    },

    async getRunLog(runId: string, options): Promise<string> {
      const raw = safeGh(`run view ${runId} ${repoFlag} --log-failed`);
      if (!raw) return "";
      if (options?.tail === undefined) return raw;
      const lines = raw.split("\n");
      return lines.slice(Math.max(0, lines.length - options.tail)).join("\n");
    },

    async mergePullRequest(number: number, method): Promise<void> {
      gh(`pr merge ${number} ${repoFlag} --${method} --auto`);
    },
  };
}
