import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAddBreadcrumb, mockCaptureException } = vi.hoisted(() => ({
  mockAddBreadcrumb: vi.fn(),
  mockCaptureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: mockAddBreadcrumb,
  captureException: mockCaptureException,
}));

import { getLatestRun, getQueryResultContent } from "../mode";

describe("Mode transport resilience", () => {
  const originalToken = process.env.MODE_API_TOKEN;
  const originalSecret = process.env.MODE_API_SECRET;
  const originalWorkspace = process.env.MODE_WORKSPACE;

  beforeEach(() => {
    process.env.MODE_API_TOKEN = "mode-token";
    process.env.MODE_API_SECRET = "mode-secret";
    process.env.MODE_WORKSPACE = "pave";
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env.MODE_API_TOKEN = originalToken;
    process.env.MODE_API_SECRET = originalSecret;
    process.env.MODE_WORKSPACE = originalWorkspace;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockAddBreadcrumb.mockClear();
    mockCaptureException.mockClear();
  });

  it("retries metadata requests using Retry-After seconds exactly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            _embedded: {
              report_runs: [
                {
                  token: "run-1",
                  state: "succeeded",
                  created_at: "2026-04-09T12:00:00Z",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const promise = getLatestRun("report-token");

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "rate_limit.mode",
        data: expect.objectContaining({
          waitMs: 2_000,
          path: "/reports/report-token/runs",
          attempt: 1,
          source: "retry-after",
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({
      token: "run-1",
      state: "succeeded",
      created_at: "2026-04-09T12:00:00Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to exponential backoff when Retry-After is unusable", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "not-a-number" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ revenue: 42 }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const promise = getQueryResultContent(
      "report-token",
      "run-token",
      "query-run-token",
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "rate_limit.mode",
        data: expect.objectContaining({
          waitMs: 500,
          path: "/reports/report-token/runs/run-token/query_runs/query-run-token/results/content.json?limit=1000",
          attempt: 1,
          source: "backoff",
        }),
      }),
    );

    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toMatchObject({
      rows: [{ revenue: 42 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on metadata auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getLatestRun("report-token")).rejects.toThrow(
      "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "mode",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          path: "/reports/report-token/runs",
          requestType: "metadata",
          status: 401,
          responseBody: "unauthorized",
        }),
      }),
    );
  });

  it("fails immediately on query result auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("forbidden", {
        status: 403,
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getQueryResultContent("report-token", "run-token", "query-run-token"),
    ).rejects.toThrow(
      "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "mode",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          path: "/reports/report-token/runs/run-token/query_runs/query-run-token/results/content.json?limit=1000",
          requestType: "query-result",
          status: 403,
          responseBody: "forbidden",
        }),
      }),
    );
  });
});
