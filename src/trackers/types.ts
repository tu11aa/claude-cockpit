export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  assignees: string[];
  url: string;
  updatedAt: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed" | "merged";
  headSha: string;
  url: string;
  updatedAt: string;
}

export interface CheckRun {
  name: string;
  state: "success" | "failure" | "pending" | "skipped";
  link?: string;
  runId?: string;
}

export type ReviewDecision =
  | "approved"
  | "changes_requested"
  | "review_required"
  | "none";

export interface TrackerProbeResult {
  installed: boolean;
  authenticated: boolean;
}

export interface TrackerScope {
  owner?: string;
  repo?: string;
  [key: string]: unknown;
}

export interface IssueFilter {
  labels?: string[];
  state?: "open" | "closed";
  assigned?: boolean;
}

export interface TrackerDriver {
  name: string;

  probe(): Promise<TrackerProbeResult>;

  listIssues(filter: IssueFilter): Promise<Issue[]>;
  createIssue(input: { title: string; body: string; labels?: string[] }): Promise<{
    number: number;
    url: string;
  }>;

  listPullRequests(filter: { state?: "open" | "closed" | "all" }): Promise<PullRequest[]>;
  getPullRequestChecks(number: number): Promise<CheckRun[]>;
  getPullRequestReviewDecision(number: number): Promise<ReviewDecision>;
  getRunLog(runId: string, options?: { tail?: number }): Promise<string>;
  mergePullRequest(number: number, method: "merge" | "squash" | "rebase"): Promise<void>;
}

export type TrackerFactory = (scope: TrackerScope) => TrackerDriver;
