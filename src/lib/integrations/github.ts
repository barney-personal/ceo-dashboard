import * as Sentry from "@sentry/nextjs";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 30_000;
const GITHUB_MAX_RETRIES = 3;
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

        if (res.status === 401 || res.status === 403) {
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

        const error = new Error(`GitHub API error ${res.status}: ${body}`);
        if (
          attempt < GITHUB_MAX_RETRIES &&
          (res.status === 429 || res.status >= 500)
        ) {
          lastError = error;
          if (res.status === 429) {
            const retryAfter = res.headers.get("retry-after");
            const waitMs = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : getRetryDelayMs(attempt);
            Sentry.addBreadcrumb({
              category: "github.rate_limit",
              level: "warning",
              message: `Rate limited on ${path}, waiting ${waitMs}ms`,
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

interface GitHubPullRequest {
  number: number;
  title: string;
  user: { login: string; avatar_url: string } | null;
  merged_at: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
}

interface GitHubPullRequestListItem {
  number: number;
  user: { login: string; avatar_url: string } | null;
  merged_at: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkGitHubHealth(opts: {
  signal?: AbortSignal;
} = {}): Promise<void> {
  const config = getConfig();
  await githubRequest(`/orgs/${config.org}`, {
    signal: opts.signal,
    timeoutMs: 5_000,
  });
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
      if (new Date(pr.merged_at) < since) {
        return merged;
      }
      merged.push(pr);
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
  opts: { signal?: AbortSignal; onRepoProgress?: (repo: string) => void } = {}
): Promise<EngineerPRStats[]> {
  const repos = await getOrgRepos(opts);
  const statsMap = new Map<string, EngineerPRStats>();

  for (const repo of repos) {
    opts.onRepoProgress?.(repo.full_name);

    const mergedPRs = await getMergedPRs(repo.full_name, since, opts);

    // Fetch PR details in bounded concurrency (3 at a time)
    const details = await mapWithConcurrency(
      mergedPRs,
      (pr) => getPRDetails(repo.full_name, pr.number, opts),
      3
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
