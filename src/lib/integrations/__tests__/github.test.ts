import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import {
  computeReviewRounds,
  fetchMergedPRRecords,
  getUserProfileOrNull,
  GitHubApiError,
  inferPrimarySurface,
} from "../github";

interface FakeNode {
  number: number;
  createdAt: string;
  mergedAt: string;
  login?: string;
}

function buildResponse(nodes: FakeNode[], hasNextPage: boolean, cursor = "c") {
  return new Response(
    JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            pageInfo: {
              hasNextPage,
              endCursor: hasNextPage ? cursor : null,
            },
            nodes: nodes.map((n) => ({
              number: n.number,
              title: `PR ${n.number}`,
              createdAt: n.createdAt,
              mergedAt: n.mergedAt,
              additions: 1,
              deletions: 1,
              changedFiles: 1,
              author: { login: n.login ?? "alice", avatarUrl: "http://x" },
            })),
          },
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("fetchMergedPRRecords pagination", () => {
  const originalToken = process.env.GITHUB_API_TOKEN;
  const originalOrg = process.env.GITHUB_ORG;

  beforeEach(() => {
    process.env.GITHUB_API_TOKEN = "tok";
    process.env.GITHUB_ORG = "acme";
  });

  afterEach(() => {
    process.env.GITHUB_API_TOKEN = originalToken;
    process.env.GITHUB_ORG = originalOrg;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps walking past pages whose PRs are all out of window, as long as createdAt is still within margin", async () => {
    // since = 2026-01-01. margin = 90 days. stopCreatedAt = 2025-10-03.
    const since = new Date("2026-01-01T00:00:00Z");

    // Page 1: a PR merged just inside window (mergedAt=2026-02-10, createdAt=2026-02-01)
    const page1 = buildResponse(
      [
        { number: 100, createdAt: "2026-02-01", mergedAt: "2026-02-10" },
      ],
      true,
      "p1",
    );
    // Page 2: PRs merged BEFORE `since` (out of window) but still created after stopCreatedAt.
    // Old heuristic (5 empty pages) would count this as 1 empty page. We should NOT stop here.
    const page2 = buildResponse(
      [
        { number: 99, createdAt: "2025-12-15", mergedAt: "2025-11-15" },
      ],
      true,
      "p2",
    );
    // Page 3: PR merged inside window again (created 2025-12-01, merged 2026-01-15)
    // This PR would have been DROPPED by the old sync if the previous page triggered early termination.
    const page3 = buildResponse(
      [
        { number: 98, createdAt: "2025-12-01", mergedAt: "2026-01-15" },
      ],
      false, // no next page
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);
    vi.stubGlobal("fetch", fetchMock);

    const captured: number[] = [];
    const result = await fetchMergedPRRecords(since, {
      repos: ["r1"],
      onPage: async (records) => {
        captured.push(...records.map((r) => r.prNumber));
      },
    });

    expect(result.total).toBe(2);
    expect(captured).toEqual([100, 98]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("terminates when an entire page is older than since - margin", async () => {
    // since = 2026-01-01, margin = 90 days, stopCreatedAt = 2025-10-03
    const since = new Date("2026-01-01T00:00:00Z");

    // Page 1: in-window PR
    const page1 = buildResponse(
      [{ number: 10, createdAt: "2026-01-15", mergedAt: "2026-02-01" }],
      true,
      "p1",
    );
    // Page 2: max createdAt (2025-09-01) < stopCreatedAt (2025-10-03) → STOP
    const page2 = buildResponse(
      [
        { number: 9, createdAt: "2025-09-01", mergedAt: "2025-09-15" },
        { number: 8, createdAt: "2025-08-15", mergedAt: "2025-08-20" },
      ],
      true,
      "p2",
    );
    // Page 3: should never be fetched
    const page3 = buildResponse(
      [{ number: 7, createdAt: "2025-07-01", mergedAt: "2025-07-15" }],
      false,
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMergedPRRecords(since, {
      repos: ["r1"],
    });

    expect(result.total).toBe(1); // only the in-window PR (page 2's PRs pre-date `since`)
    expect(fetchMock).toHaveBeenCalledTimes(2); // page 3 skipped
  });

  it("skips PRs with null author but continues walking", async () => {
    const since = new Date("2026-01-01T00:00:00Z");

    const response = new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  number: 1,
                  title: "ghosted",
                  createdAt: "2026-02-01",
                  mergedAt: "2026-02-10",
                  additions: 0,
                  deletions: 0,
                  changedFiles: 0,
                  author: null,
                },
                {
                  number: 2,
                  title: "ok",
                  createdAt: "2026-02-01",
                  mergedAt: "2026-02-10",
                  additions: 0,
                  deletions: 0,
                  changedFiles: 0,
                  author: { login: "bob", avatarUrl: "http://x" },
                },
              ],
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const fetchMock = vi.fn().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMergedPRRecords(since, { repos: ["r1"] });
    expect(result.total).toBe(1);
  });
});

describe("getUserProfileOrNull", () => {
  const originalToken = process.env.GITHUB_API_TOKEN;
  const originalOrg = process.env.GITHUB_ORG;

  beforeEach(() => {
    process.env.GITHUB_API_TOKEN = "tok";
    process.env.GITHUB_ORG = "acme";
  });

  afterEach(() => {
    process.env.GITHUB_API_TOKEN = originalToken;
    process.env.GITHUB_ORG = originalOrg;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns null when the GitHub user has been deleted (404)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const profile = await getUserProfileOrNull("ghost-user");
    expect(profile).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the profile for a 200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ login: "alice", name: "Alice", email: "alice@example.com" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const profile = await getUserProfileOrNull("alice");
    expect(profile).toMatchObject({ login: "alice", name: "Alice" });
  });

  it("re-throws non-404 errors as GitHubApiError", async () => {
    // 502 is retryable — serve a fresh Response on every call so the body
    // isn't consumed twice.
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response("upstream bad gateway", { status: 502 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    // Short-circuit the retry backoff so the test finishes in well under a
    // second rather than waiting on real exponential backoff.
    vi.spyOn(global, "setTimeout").mockImplementation(((
      fn: () => void,
    ) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    await expect(getUserProfileOrNull("alice")).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });
});

describe("inferPrimarySurface", () => {
  it("returns the dominant surface when one area clearly outweighs the rest", () => {
    const surface = inferPrimarySurface([
      {
        filename: "src/lib/sync/code-review.ts",
        status: "modified",
        additions: 140,
        deletions: 20,
        changes: 160,
      },
      {
        filename: "src/components/button.tsx",
        status: "modified",
        additions: 10,
        deletions: 5,
        changes: 15,
      },
    ]);

    expect(surface).toBe("backend");
  });

  it("returns mixed when no single surface clears the dominance threshold", () => {
    const surface = inferPrimarySurface([
      {
        filename: "src/lib/sync/code-review.ts",
        status: "modified",
        additions: 60,
        deletions: 20,
        changes: 80,
      },
      {
        filename: "src/components/button.tsx",
        status: "modified",
        additions: 60,
        deletions: 20,
        changes: 80,
      },
    ]);

    expect(surface).toBe("mixed");
  });
});

describe("computeReviewRounds", () => {
  it("returns zero when there are no reviews", () => {
    expect(computeReviewRounds([], [new Date("2026-04-20T10:00:00Z")])).toBe(0);
  });

  it("increments rounds only when later commits are followed by another review", () => {
    const rounds = computeReviewRounds(
      [
        new Date("2026-04-20T10:00:00Z"),
        new Date("2026-04-20T14:00:00Z"),
        new Date("2026-04-21T11:00:00Z"),
      ],
      [
        new Date("2026-04-20T09:00:00Z"),
        new Date("2026-04-20T12:00:00Z"),
        new Date("2026-04-20T16:00:00Z"),
        new Date("2026-04-22T09:00:00Z"),
      ],
    );

    expect(rounds).toBe(3);
  });
});
