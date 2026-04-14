import * as Sentry from "@sentry/nextjs";

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

        const error = new Error(`GitHub API error ${res.status}: ${body}`);
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
const GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: MERGED
      first: 100
      after: $cursor
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
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
      throw new Error(`GitHub GraphQL error ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { data: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`GitHub GraphQL: ${json.errors[0].message}`);
    }
    return json.data;
  } finally {
    clearTimeout(timeoutId);
    opts.signal?.removeEventListener("abort", onParentAbort);
  }
}

interface GraphQLPRNode {
  number: number;
  title: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string; avatarUrl: string } | null;
}

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
    repos?: string[];
  } = {}
): Promise<MergedPRRecord[]> {
  const config = getConfig();
  const repoNames = opts.repos?.length
    ? opts.repos
    : (await getOrgRepos(opts)).map((r) => r.name);

  const records: MergedPRRecord[] = [];

  for (const repoName of repoNames) {
    let cursor: string | null = null;
    let repoCount = 0;
    let reachedEnd = false;

    while (!reachedEnd) {
      const gqlData: GraphQLPRResponse = await graphqlRequest(
        GRAPHQL_QUERY,
        { owner: config.org, repo: repoName, cursor },
        opts
      );

      const { nodes, pageInfo } = gqlData.repository.pullRequests;

      for (const pr of nodes) {
        const mergedAt = new Date(pr.mergedAt);
        if (mergedAt < since) {
          reachedEnd = true;
          break;
        }
        if (!pr.author) continue;

        records.push({
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

      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }

    opts.onRepoProgress?.(repoName, repoCount);
  }

  return records;
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
    repos?: string[];
  } = {}
): Promise<CommitRecord[]> {
  const config = getConfig();
  const repoNames = opts.repos?.length
    ? opts.repos
    : (await getOrgRepos(opts)).map((r) => r.name);

  const records: CommitRecord[] = [];

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

      for (const commit of nodes) {
        // Skip commits without a linked GitHub user (e.g. bot email-only commits)
        if (!commit.author.user) continue;

        records.push({
          repo: repoName,
          sha: commit.oid,
          authorLogin: commit.author.user.login,
          authorAvatarUrl: commit.author.user.avatarUrl,
          committedAt: new Date(commit.committedDate),
          additions: commit.additions,
          deletions: commit.deletions,
          message: commit.message.split("\n")[0], // first line only
        });
        repoCount++;
      }

      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }

    opts.onRepoProgress?.(repoName, repoCount);
  }

  return records;
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
