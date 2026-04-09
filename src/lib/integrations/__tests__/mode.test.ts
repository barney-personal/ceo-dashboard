import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCaptureException } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
}));

import { getLatestRun, getQueryResultContent } from "../mode";

describe("Mode transport auth errors", () => {
  const originalToken = process.env.MODE_API_TOKEN;
  const originalSecret = process.env.MODE_API_SECRET;
  const originalWorkspace = process.env.MODE_WORKSPACE;

  beforeEach(() => {
    process.env.MODE_API_TOKEN = "mode-token";
    process.env.MODE_API_SECRET = "mode-secret";
    process.env.MODE_WORKSPACE = "pave";
  });

  afterEach(() => {
    process.env.MODE_API_TOKEN = originalToken;
    process.env.MODE_API_SECRET = originalSecret;
    process.env.MODE_WORKSPACE = originalWorkspace;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockCaptureException.mockClear();
  });

  it("fails immediately on metadata auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("unauthorized", {
        status: 401,
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getLatestRun("report-token")).rejects.toThrow(
      "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler",
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
      })
    );
  });

  it("fails immediately on query result auth errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("forbidden", {
        status: 403,
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getQueryResultContent("report-token", "run-token", "query-run-token")
    ).rejects.toThrow("Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Mode API returned 401 — check MODE_API_TOKEN and MODE_API_SECRET in Doppler",
      }),
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          integration: "mode",
          auth_failure: "true",
        }),
        extra: expect.objectContaining({
          path:
            "/reports/report-token/runs/run-token/query_runs/query-run-token/results/content.json?limit=1000",
          requestType: "query-result",
          status: 403,
          responseBody: "forbidden",
        }),
      })
    );
  });
});
