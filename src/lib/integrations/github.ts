import * as Sentry from "@sentry/nextjs";
import type { CodeReviewSurface } from "./code-review-rubric";

export class GitHubApiError extends Error {
  status: number;
  path: string;

  constructor(status: number, path: string, body: string) {
    super(`GitHub API error ${status}: ${body}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.path = path;
  }
}

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 30_000;
const GITHUB_MAX_RETRIES = 5;
const GITHUB_PER_PAGE = 100;

interface GitHubConfig {
  token: string;
  org: string;
}

function getConfig(): GitHubConfig {
  const token = process.env.GITHUB_API_TOKEN;
  const org = process.env.GITHUB_ORG;

  if (!token || !org) {
    const error = new Error(
      "Missing GitHub config: GITHUB_API_TOKEN and GITHUB_ORG are required"
    );
    Sentry.captureException(error, {
      tags: { integration: "github" },
      extra: { operation: "getConfig" },
    });
    throw error;
  }

  return { token, org };
}

function authHeaders(config: GitHubConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(attempt: number): number {
  return 500 * Math.pow(2, attempt - 1) + Math.random() * 250;
}

async function githubRequest<T>(
  path: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const config = getConfig();
  const url = path.startsWith("http") ? path : `${GITHUB_API_BASE}${path}`;
  const { signal: parentSignal, timeoutMs } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= GITHUB_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error("GitHub request timed out")),
      timeoutMs ?? GITHUB_TIMEOUT_MS
    );

    if (parentSignal?.aborted) {
      clearTimeout(timeoutId);
      throw parentSignal.reason instanceof Error
        ? parentSignal.reason
        : new Error("GitHub request was aborted");
    }

    const onParentAbort = () => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: authHeaders(config),
      });

      if (!res.ok) {
        const body = await res.text();
        const retryAfter = res.headers.get("retry-after");

        // Determine if this is a rate limit response (429 or 403 with rate limit info)
        const rateLimitRemaining = res.headers.get("x-ratelimit-remaining");
        const rateLimitReset = res.headers.get("x-ratelimit-reset");
        const isRateLimit =
          res.status === 429 ||
          (res.status === 403 &&
            (retryAfter || rateLimitRemaining === "0"));

        // Only treat 401 and non-rate-limit 403 as auth errors
        if (res.status === 401 || (res.status === 403 && !isRateLimit)) {
          const error = new Error(
            `GitHub API auth error ${res.status} — check GITHUB_API_TOKEN`
          );
          Sentry.captureException(error, {
            level: "error",
            tags: { integration: "github", auth_failure: "true" },
            extra: { path, status: res.status, responseBody: body },
          });
          throw error;
        }

        const error = new GitHubApiError(res.status, path, body);
        if (
          attempt < GITHUB_MAX_RETRIES &&
          (isRateLimit || res.status >= 500)
        ) {
          lastError = error;
          if (isRateLimit) {
            let waitMs: number;
            if (retryAfter) {
              waitMs = parseInt(retryAfter, 10) * 1000;
            } else if (rateLimitReset) {
              waitMs = Math.max(
                1000,
                parseInt(rateLimitReset, 10) * 1000 - Date.now()
              );
            } else {
              waitMs = getRetryDelayMs(attempt);
            }
            Sentry.addBreadcrumb({
              category: "github.rate_limit",
              level: "warning",
              message: `Rate limited (${res.status}) on ${path}, waiting ${Math.round(waitMs / 1000)}s`,
            });
            await sleep(waitMs);
          } else {
            await sleep(getRetryDelayMs(attempt));
          }
          continue;
        }
        throw error;
      }

      return res.json() as Promise<T>;
    } catch (error) {
      if (controller.signal.aborted && parentSignal?.aborted) {
        throw parentSignal.reason instanceof Error
          ? parentSignal.reason
          : new Error("GitHub request was aborted");
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("timed out")) {
        throw new Error("GitHub request timed out");
      }

      if (attempt < GITHUB_MAX_RETRIES && isRetryable(message)) {
        lastError = error instanceof Error ? error : new Error(message);
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      Sentry.captureException(error, {
        tags: { integration: "github" },
        extra: { path, attempt },
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastError ?? new Error("GitHub request failed");
}

function isRetryable(message: string): boolean {
  return /ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|fetch failed/i.test(
    message
  );
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

interface GitHubRepo {
  name: string;
  full_name: string;
  archived: boolean;
  fork: boolean;
  private: boolean;
}

interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  user: { login: string; avatar_url: string } | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
}

interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GitHubPullRequestListItem {
  number: number;
  user: { login: string; avatar_url: string } | null;
  merged_at: string | null;
}

interface GitHubPullRequestReview {
  id: number;
  user: { login: string } | null;
  state: string;
  submitted_at: string | null;
}

interface GitHubPullRequestComment {
  id: number;
  user: { login: string } | null;
  created_at: string;
}

interface GitHubIssueComment {
  id: number;
  user: { login: string } | null;
  created_at: string;
}

interface GitHubPullRequestCommit {
  sha: string;
  commit: {
    author: {
      date: string | null;
    } | null;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkGitHubHealth(opts: {
  signal?: AbortSignal;
} = {}): Promise<void> {
  // Use GraphQL for the health check — it has a separate (higher) rate limit
  // bucket from the REST API, so it won't fail when REST is exhausted.
  await graphqlRequest("{ viewer { login } }", {}, opts);
}

export async function getUserProfile(
  login: string,
  opts: { signal?: AbortSignal } = {}
): Promise<GitHubUser> {
  return githubRequest<GitHubUser>(`/users/${login}`, {
    signal: opts.signal,
  });
}

// Variant that returns null for deleted/renamed GitHub accounts (HTTP 404)
// instead of throwing. Callers iterating over a list of historical logins
// shouldn't treat an absent user as an error — the employee-match flow
// previously produced ~27 Sentry issues per week from such lookups.
export async function getUserProfileOrNull(
  login: string,
  opts: { signal?: AbortSignal } = {}
): Promise<GitHubUser | null> {
  try {
    return await getUserProfile(login, opts);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getOrgRepos(opts: {
  signal?: AbortSignal;
} = {}): Promise<GitHubRepo[]> {
  const config = getConfig();
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const batch = await githubRequest<GitHubRepo[]>(
      `/orgs/${config.org}/repos?type=all&per_page=${GITHUB_PER_PAGE}&page=${page}`,
      { signal: opts.signal }
    );
    repos.push(...batch);
    if (batch.length < GITHUB_PER_PAGE) break;
    page++;
  }

  return repos.filter((r) => !r.archived && !r.fork);
}

export async function getMergedPRs(
  repoFullName: string,
  since: Date,
  opts: { signal?: AbortSignal } = {}
): Promise<GitHubPullRequestListItem[]> {
  const merged: GitHubPullRequestListItem[] = [];
  let page = 1;

  while (true) {
    const batch = await githubRequest<GitHubPullRequestListItem[]>(
      `/repos/${repoFullName}/pulls?state=closed&sort=updated&direction=desc&per_page=${GITHUB_PER_PAGE}&page=${page}`,
      { signal: opts.signal }
    );

    for (const pr of batch) {
      if (!pr.merged_at) continue;
      if (new Date(pr.merged_at) >= since) {
        merged.push(pr);
      }
    }

    if (batch.length < GITHUB_PER_PAGE) break;
    page++;
  }

  return merged;
}

export async function getPRDetails(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {}
): Promise<GitHubPullRequest> {
  return githubRequest<GitHubPullRequest>(
    `/repos/${repoFullName}/pulls/${prNumber}`,
    { signal: opts.signal }
  );
}

export async function getPRFiles(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {},
): Promise<GitHubPullRequestFile[]> {
  // GitHub caps /files at 3000 files and 30 pages of 100. For code-review
  // purposes we'll never need more than 100 — if a PR touches that many
  // files, we already know it's huge without reading every diff.
  return githubRequest<GitHubPullRequestFile[]>(
    `/repos/${repoFullName}/pulls/${prNumber}/files?per_page=100`,
    { signal: opts.signal },
  );
}

async function getPaginatedGitHubResource<T>(
  buildPath: (page: number) => string,
  opts: { signal?: AbortSignal } = {},
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;

  while (true) {
    const batch = await githubRequest<T[]>(buildPath(page), {
      signal: opts.signal,
    });
    all.push(...batch);
    if (batch.length < GITHUB_PER_PAGE) break;
    page++;
  }

  return all;
}

async function getPRReviews(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {},
): Promise<GitHubPullRequestReview[]> {
  return getPaginatedGitHubResource(
    (page) =>
      `/repos/${repoFullName}/pulls/${prNumber}/reviews?per_page=${GITHUB_PER_PAGE}&page=${page}`,
    opts,
  );
}

async function getPRReviewComments(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {},
): Promise<GitHubPullRequestComment[]> {
  return getPaginatedGitHubResource(
    (page) =>
      `/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=${GITHUB_PER_PAGE}&page=${page}`,
    opts,
  );
}

async function getPRIssueComments(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {},
): Promise<GitHubIssueComment[]> {
  return getPaginatedGitHubResource(
    (page) =>
      `/repos/${repoFullName}/issues/${prNumber}/comments?per_page=${GITHUB_PER_PAGE}&page=${page}`,
    opts,
  );
}

async function getPRCommits(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {},
): Promise<GitHubPullRequestCommit[]> {
  return getPaginatedGitHubResource(
    (page) =>
      `/repos/${repoFullName}/pulls/${prNumber}/commits?per_page=${GITHUB_PER_PAGE}&page=${page}`,
    opts,
  );
}

function hoursBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return (end - start) / (1000 * 60 * 60);
}

function classifySurface(filename: string): CodeReviewSurface | null {
  if (/^(ios|android|mobile)\//i.test(filename)) return "mobile";
  if (
    /^(\.github|infra|terraform|ops|scripts)\//i.test(filename) ||
    /^Dockerfile$|^render\.ya?ml$/i.test(filename)
  ) {
    return "infra";
  }
  if (
    /(^|\/)(sql|dbt|warehouse|analytics|mode)\//i.test(filename) ||
    /(\.sql|\.psql)$/i.test(filename)
  ) {
    return "data";
  }
  if (
    /^src\/app\/api\//.test(filename) ||
    /^src\/lib\/(db|sync|integrations|auth)\//.test(filename) ||
    /^api\//.test(filename)
  ) {
    return "backend";
  }
  if (
    /^src\/components\//.test(filename) ||
    /^src\/app\/(?!api\/)/.test(filename) ||
    /^styles\//.test(filename) ||
    /\.(tsx|jsx|css|scss|sass|less)$/i.test(filename)
  ) {
    return "frontend";
  }
  if (/(^|\/)__tests__\/|\.test\.|\.spec\./.test(filename)) {
    return /\.tsx|\.jsx/i.test(filename) ? "frontend" : "backend";
  }
  return null;
}

export function inferPrimarySurface(
  files: GitHubPullRequestFile[],
): CodeReviewSurface {
  const weights: Record<CodeReviewSurface, number> = {
    frontend: 0,
    backend: 0,
    data: 0,
    infra: 0,
    mobile: 0,
    mixed: 0,
  };

  for (const file of files) {
    const surface = classifySurface(file.filename);
    if (!surface) continue;
    weights[surface] += Math.max(1, file.additions + file.deletions);
  }

  let best: CodeReviewSurface = "mixed";
  let bestWeight = 0;
  let total = 0;
  for (const surface of ["frontend", "backend", "data", "infra", "mobile"] as const) {
    const weight = weights[surface];
    total += weight;
    if (weight > bestWeight) {
      best = surface;
      bestWeight = weight;
    }
  }

  if (total === 0) return "mixed";
  return bestWeight / total >= 0.55 ? best : "mixed";
}

export function computeReviewRounds(
  reviewTimes: Date[],
  commitTimes: Date[],
): number {
  if (reviewTimes.length === 0) return 0;
  const sortedReviews = [...reviewTimes].sort((a, b) => a.getTime() - b.getTime());
  const sortedCommits = [...commitTimes].sort((a, b) => a.getTime() - b.getTime());
  let rounds = 1;
  let nextReviewIdx = 1;
  let lastRoundAt = sortedReviews[0];

  for (const commitTime of sortedCommits) {
    if (commitTime <= lastRoundAt) continue;
    while (
      nextReviewIdx < sortedReviews.length &&
      sortedReviews[nextReviewIdx] <= commitTime
    ) {
      nextReviewIdx++;
    }
    if (nextReviewIdx < sortedReviews.length) {
      rounds++;
      lastRoundAt = sortedReviews[nextReviewIdx];
      nextReviewIdx++;
    }
  }

  return rounds;
}

export interface PRAnalysisPayload {
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  createdAt: string;
  mergedAt: string;
  mergeSha: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  primarySurface: CodeReviewSurface;
  review: {
    approvalCount: number;
    changeRequestCount: number;
    reviewCommentCount: number;
    conversationCommentCount: number;
    reviewRounds: number;
    timeToFirstReviewHours: number | null;
    timeToMergeHours: number;
    commitCount: number;
    commitsAfterFirstReview: number;
    revertWithin14d: boolean;
  };
  /** Filename + patch for each non-skipped file, already truncated to fit
   * within the prompt budget. A file with `truncated: true` had its patch
   * elided; a file with `skipped: true` is lockfile/generated/etc. */
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch: string | null;
    truncated: boolean;
    skipped: boolean;
    skipReason?: string;
  }>;
  /** Notes for the reviewer prompt — e.g. "Large diff, 40 files truncated" */
  prNotes: string[];
}

/** Files we never feed to Claude — generated output, lockfiles, vendored
 * code, etc. The scorer can't meaningfully judge these and they eat tokens. */
const SKIP_FILE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^package-lock\.json$|^npm-shrinkwrap\.json$/, reason: "npm lockfile" },
  { pattern: /^yarn\.lock$|^pnpm-lock\.yaml$|^bun\.lockb$/, reason: "lockfile" },
  { pattern: /^Cargo\.lock$|^poetry\.lock$|^Pipfile\.lock$/, reason: "lockfile" },
  { pattern: /\.min\.(js|css)$/, reason: "minified asset" },
  { pattern: /^dist\/|\/dist\//, reason: "build output" },
  { pattern: /^build\/|\/build\//, reason: "build output" },
  { pattern: /\.generated\.(ts|js|tsx|jsx|go|py)$/, reason: "generated code" },
  { pattern: /^vendor\/|\/vendor\//, reason: "vendored code" },
  { pattern: /^node_modules\/|\/node_modules\//, reason: "vendored code" },
  { pattern: /\.svg$|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.ico$/, reason: "binary/image" },
  { pattern: /^drizzle\/meta\//, reason: "drizzle metadata" },
];

function classifyFileSkip(filename: string): string | null {
  for (const { pattern, reason } of SKIP_FILE_PATTERNS) {
    if (pattern.test(filename)) return reason;
  }
  return null;
}

/** Total characters of patch content we'll send to Claude per PR. Sonnet
 * can handle far more but truncating keeps per-PR cost + latency predictable
 * and forces us to prioritise signal over volume. */
const MAX_PATCH_CHARS = 30_000;

/**
 * Fetch + shape a PR for Claude analysis. Non-code files are marked skipped
 * (not sent to the model, but counted). Remaining patches are concatenated
 * in priority order (src/* before tests before config) and truncated to
 * MAX_PATCH_CHARS.
 */
export async function fetchPRAnalysisPayload(
  repoFullName: string,
  prNumber: number,
  opts: { signal?: AbortSignal } = {},
): Promise<PRAnalysisPayload> {
  const [details, files, reviews, reviewComments, issueComments, commits] = await Promise.all([
    getPRDetails(repoFullName, prNumber, opts),
    getPRFiles(repoFullName, prNumber, opts),
    getPRReviews(repoFullName, prNumber, opts),
    getPRReviewComments(repoFullName, prNumber, opts),
    getPRIssueComments(repoFullName, prNumber, opts),
    getPRCommits(repoFullName, prNumber, opts),
  ]);

  const notes: string[] = [];
  const authorLogin = details.user?.login?.toLowerCase() ?? null;
  // Sort: prefer source files over tests over config over the rest. Same
  // ordering decides which patches survive truncation.
  function priority(filename: string): number {
    if (/\.(md|rst|txt)$/i.test(filename)) return 4;
    if (/(^|\/)__tests__\/|\.test\.|\.spec\./.test(filename)) return 2;
    if (/^package\.json$|^tsconfig|\.yaml$|\.yml$|\.toml$|\.ini$/.test(filename)) return 3;
    return 1;
  }

  const sorted = [...files].sort((a, b) => priority(a.filename) - priority(b.filename));
  let budget = MAX_PATCH_CHARS;
  const processed: PRAnalysisPayload["files"] = [];
  let truncatedCount = 0;

  for (const f of sorted) {
    const skipReason = classifyFileSkip(f.filename);
    if (skipReason) {
      processed.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: null,
        truncated: false,
        skipped: true,
        skipReason,
      });
      continue;
    }
    if (!f.patch) {
      processed.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: null,
        truncated: false,
        skipped: true,
        skipReason: "no patch (likely binary or too large)",
      });
      continue;
    }
    if (budget <= 0) {
      processed.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: null,
        truncated: true,
        skipped: false,
      });
      truncatedCount++;
      continue;
    }
    if (f.patch.length > budget) {
      processed.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch.slice(0, budget) + "\n// … (truncated)",
        truncated: true,
        skipped: false,
      });
      budget = 0;
      truncatedCount++;
      continue;
    }
    processed.push({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
      truncated: false,
      skipped: false,
    });
    budget -= f.patch.length;
  }

  if (truncatedCount > 0) {
    notes.push(
      `Diff was truncated (${truncatedCount} file(s) partially or fully elided) — judge within the visible scope.`,
    );
  }
  const skippedCount = processed.filter((f) => f.skipped).length;
  if (skippedCount > 0) {
    notes.push(
      `${skippedCount} non-code file(s) excluded (lockfiles, generated, binary).`,
    );
  }
  if (files.length >= 100) {
    notes.push("PR touches ≥100 files — GitHub API cap; not all files visible.");
  }

  const filteredReviews = reviews.filter((review) => {
    if (!review.submitted_at) return false;
    if (!review.user?.login) return false;
    if (authorLogin && review.user.login.toLowerCase() === authorLogin) return false;
    return review.state !== "PENDING";
  });
  const approvalCount = filteredReviews.filter((r) => r.state === "APPROVED").length;
  const changeRequestCount = filteredReviews.filter(
    (r) => r.state === "CHANGES_REQUESTED",
  ).length;
  const filteredReviewComments = reviewComments.filter(
    (comment) =>
      !authorLogin ||
      comment.user?.login?.toLowerCase() !== authorLogin,
  );
  const filteredIssueComments = issueComments.filter(
    (comment) =>
      !authorLogin ||
      comment.user?.login?.toLowerCase() !== authorLogin,
  );
  const reviewTimes = filteredReviews
    .map((review) => new Date(review.submitted_at!))
    .filter((date) => Number.isFinite(date.getTime()));
  const commitTimes = commits
    .map((commit) => commit.commit.author?.date)
    .filter((date): date is string => typeof date === "string")
    .map((date) => new Date(date))
    .filter((date) => Number.isFinite(date.getTime()));
  const firstReviewIso =
    filteredReviews
      .map((review) => review.submitted_at)
      .filter((date): date is string => typeof date === "string")
      .sort()[0] ?? null;
  const commitsAfterFirstReview =
    firstReviewIso === null
      ? 0
      : commitTimes.filter((commitTime) => commitTime > new Date(firstReviewIso)).length;
  const timeToMergeHours =
    hoursBetween(details.created_at, details.merged_at) ?? 0;
  const timeToFirstReviewHours = hoursBetween(details.created_at, firstReviewIso);

  return {
    repo: repoFullName,
    prNumber,
    title: details.title,
    body: (details.body ?? "").slice(0, 4000),
    createdAt: details.created_at,
    mergedAt: details.merged_at ?? new Date().toISOString(),
    mergeSha: details.merge_commit_sha,
    additions: details.additions,
    deletions: details.deletions,
    changedFiles: details.changed_files,
    primarySurface: inferPrimarySurface(files),
    review: {
      approvalCount,
      changeRequestCount,
      reviewCommentCount: filteredReviewComments.length,
      conversationCommentCount: filteredIssueComments.length,
      reviewRounds: computeReviewRounds(reviewTimes, commitTimes),
      timeToFirstReviewHours,
      timeToMergeHours,
      commitCount: commits.length,
      commitsAfterFirstReview,
      revertWithin14d: false,
    },
    files: processed,
    prNotes: notes,
  };
}

export interface MergedPRRecord {
  repo: string;
  prNumber: number;
  title: string;
  authorLogin: string;
  authorAvatarUrl: string;
  mergedAt: Date;
  additions: number;
  deletions: number;
  changedFiles: number;
}

// Use GitHub GraphQL API to fetch merged PRs with stats in bulk
// (avoids per-PR REST calls that exhaust the rate limit).
//
// Ordered by CREATED_AT DESC (not UPDATED_AT) so the walk is approximately
// chronological by PR number. UPDATED_AT ordering is unstable because old
// PRs bubble up whenever they get a comment / CI rerun / label change, which
// previously caused the pagination loop to terminate early and miss
// clean-merged historical PRs.
const GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: MERGED
      first: 100
      after: $cursor
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        createdAt
        mergedAt
        additions
        deletions
        changedFiles
        author {
          login
          avatarUrl
        }
      }
    }
  }
}`;

async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {}
): Promise<T> {
  const config = getConfig();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= GITHUB_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error("GitHub GraphQL request timed out")),
      GITHUB_TIMEOUT_MS
    );

    if (opts.signal?.aborted) {
      clearTimeout(timeoutId);
      throw opts.signal.reason instanceof Error
        ? opts.signal.reason
        : new Error("GitHub GraphQL request was aborted");
    }

    const onParentAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        signal: controller.signal,
        headers: {
          ...authHeaders(config),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        const body = await res.text();
        const error = new Error(`GitHub GraphQL error ${res.status}: ${body}`);

        // Retry on server errors and rate limits
        if (
          attempt < GITHUB_MAX_RETRIES &&
          (res.status >= 500 || res.status === 429)
        ) {
          lastError = error;
          Sentry.addBreadcrumb({
            category: "github.graphql",
            level: "warning",
            message: `GraphQL ${res.status} on attempt ${attempt}, retrying`,
          });
          await sleep(getRetryDelayMs(attempt));
          continue;
        }

        throw error;
      }

      const json = (await res.json()) as { data: T; errors?: { message: string }[] };
      if (json.errors?.length) {
        throw new Error(`GitHub GraphQL: ${json.errors[0].message}`);
      }
      return json.data;
    } catch (error) {
      if (controller.signal.aborted && opts.signal?.aborted) {
        throw opts.signal.reason instanceof Error
          ? opts.signal.reason
          : new Error("GitHub GraphQL request was aborted");
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("timed out")) {
        throw new Error("GitHub GraphQL request timed out");
      }

      if (attempt < GITHUB_MAX_RETRIES && isRetryable(message)) {
        lastError = error instanceof Error ? error : new Error(message);
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastError ?? new Error("GitHub GraphQL request failed");
}

interface GraphQLPRNode {
  number: number;
  title: string;
  createdAt: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string; avatarUrl: string } | null;
}

/**
 * Safety margin (ms) for the CREATED_AT-based stop condition. A PR can be
 * merged up to this many days after it was created, so we only terminate the
 * walk once we're this far past `since`. 90 days covers the long tail of
 * long-lived PRs without walking indefinitely.
 */
const CREATED_AT_STOP_MARGIN_MS = 90 * 24 * 60 * 60 * 1000;

interface GraphQLPRResponse {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GraphQLPRNode[];
    };
  };
}


export async function fetchMergedPRRecords(
  since: Date,
  opts: {
    signal?: AbortSignal;
    onRepoProgress?: (repo: string, prCount: number) => void;
    /** Called with each page of PRs as they're fetched — enables streaming to DB */
    onPage?: (records: MergedPRRecord[]) => Promise<void>;
    repos?: string[];
  } = {}
): Promise<{ total: number }> {
  const config = getConfig();
  const repoNames = opts.repos?.length
    ? opts.repos
    : (await getOrgRepos(opts)).map((r) => r.name);

  let total = 0;

  // PRs are ordered by CREATED_AT DESC. Since a PR can merge up to
  // CREATED_AT_STOP_MARGIN_MS after creation, we stop once the newest PR on
  // a page was created before `since - margin` — at that point no remaining
  // page could contain a PR merged on or after `since`.
  const stopCreatedAtMs = since.getTime() - CREATED_AT_STOP_MARGIN_MS;

  for (const repoName of repoNames) {
    let cursor: string | null = null;
    let repoCount = 0;

    while (true) {
      const gqlData: GraphQLPRResponse = await graphqlRequest(
        GRAPHQL_QUERY,
        { owner: config.org, repo: repoName, cursor },
        opts
      );

      const { nodes, pageInfo } = gqlData.repository.pullRequests;
      const page: MergedPRRecord[] = [];
      let maxCreatedAtMs = -Infinity;

      for (const pr of nodes) {
        const createdAtMs = new Date(pr.createdAt).getTime();
        if (createdAtMs > maxCreatedAtMs) maxCreatedAtMs = createdAtMs;

        if (!pr.author) continue;
        const mergedAt = new Date(pr.mergedAt);
        if (mergedAt < since) continue; // skip but don't stop — keep walking to check older pages

        page.push({
          repo: repoName,
          prNumber: pr.number,
          title: pr.title,
          authorLogin: pr.author.login,
          authorAvatarUrl: pr.author.avatarUrl,
          mergedAt,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
        });
        repoCount++;
      }

      if (page.length > 0 && opts.onPage) {
        await opts.onPage(page);
      }
      total += page.length;

      // Stop once the entire page pre-dates (since - margin): no later page
      // (older createdAt) can contain a PR merged on or after `since`.
      if (nodes.length > 0 && maxCreatedAtMs < stopCreatedAtMs) break;
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }

    opts.onRepoProgress?.(repoName, repoCount);
  }

  return { total };
}

// ---------------------------------------------------------------------------
// Commit fetching via GraphQL
// ---------------------------------------------------------------------------

export interface CommitRecord {
  repo: string;
  sha: string;
  authorLogin: string;
  authorAvatarUrl: string;
  committedAt: Date;
  additions: number;
  deletions: number;
  message: string;
}

const COMMITS_GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $since: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: 100, after: $cursor, since: $since) {
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              message
              committedDate
              additions
              deletions
              author {
                user {
                  login
                  avatarUrl
                }
              }
            }
          }
        }
      }
    }
  }
}`;

interface GraphQLCommitNode {
  oid: string;
  message: string;
  committedDate: string;
  additions: number;
  deletions: number;
  author: {
    user: { login: string; avatarUrl: string } | null;
  };
}

interface GraphQLCommitResponse {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GraphQLCommitNode[];
        };
      };
    } | null;
  };
}

export async function fetchCommitRecords(
  since: Date,
  opts: {
    signal?: AbortSignal;
    onRepoProgress?: (repo: string, commitCount: number) => void;
    /** Called with each page of commits as they're fetched — enables streaming to DB */
    onPage?: (records: CommitRecord[]) => Promise<void>;
    repos?: string[];
  } = {}
): Promise<{ total: number }> {
  const config = getConfig();
  const repoNames = opts.repos?.length
    ? opts.repos
    : (await getOrgRepos(opts)).map((r) => r.name);

  let total = 0;

  for (const repoName of repoNames) {
    let cursor: string | null = null;
    let repoCount = 0;

    while (true) {
      const gqlData: GraphQLCommitResponse = await graphqlRequest(
        COMMITS_GRAPHQL_QUERY,
        {
          owner: config.org,
          repo: repoName,
          since: since.toISOString(),
          cursor,
        },
        opts
      );

      const branch = gqlData.repository.defaultBranchRef;
      if (!branch) break;

      const { nodes, pageInfo } = branch.target.history;
      const page: CommitRecord[] = [];

      for (const commit of nodes) {
        if (!commit.author.user) continue;

        page.push({
          repo: repoName,
          sha: commit.oid,
          authorLogin: commit.author.user.login,
          authorAvatarUrl: commit.author.user.avatarUrl,
          committedAt: new Date(commit.committedDate),
          additions: commit.additions,
          deletions: commit.deletions,
          message: commit.message.split("\n")[0],
        });
        repoCount++;
      }

      if (page.length > 0 && opts.onPage) {
        await opts.onPage(page);
      }
      total += page.length;

      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }

    opts.onRepoProgress?.(repoName, repoCount);
  }

  return { total };
}

export interface EngineerPRStats {
  login: string;
  avatarUrl: string;
  prsCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  repos: Set<string>;
}

export async function getEngineeringStats(
  since: Date,
  opts: {
    signal?: AbortSignal;
    onRepoProgress?: (repo: string) => void;
    repos?: string[];
  } = {}
): Promise<EngineerPRStats[]> {
  const config = getConfig();
  let repos: GitHubRepo[];

  if (opts.repos && opts.repos.length > 0) {
    // Use specified repos instead of crawling the entire org
    repos = opts.repos.map((name) => ({
      name,
      full_name: `${config.org}/${name}`,
      archived: false,
      fork: false,
      private: true,
    }));
  } else {
    repos = await getOrgRepos(opts);
  }

  const statsMap = new Map<string, EngineerPRStats>();

  for (const repo of repos) {
    opts.onRepoProgress?.(repo.full_name);

    const mergedPRs = await getMergedPRs(repo.full_name, since, opts);

    // Fetch PR details in bounded concurrency (10 at a time)
    const details = await mapWithConcurrency(
      mergedPRs,
      (pr) => getPRDetails(repo.full_name, pr.number, opts),
      10
    );

    for (const pr of details) {
      if (!pr.user) continue;
      const login = pr.user.login;

      let stats = statsMap.get(login);
      if (!stats) {
        stats = {
          login,
          avatarUrl: pr.user.avatar_url,
          prsCount: 0,
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          repos: new Set(),
        };
        statsMap.set(login, stats);
      }

      stats.prsCount += 1;
      stats.additions += pr.additions;
      stats.deletions += pr.deletions;
      stats.changedFiles += pr.changed_files;
      stats.repos.add(repo.name);
    }
  }

  return Array.from(statsMap.values());
}

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );

  return results;
}
