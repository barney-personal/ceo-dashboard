import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAddBreadcrumb, mockCaptureException } = vi.hoisted(() => ({
  mockAddBreadcrumb: vi.fn(),
  mockCaptureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: mockAddBreadcrumb,
  captureException: mockCaptureException,
}));

import {
  checkModeHealth,
  getLatestRun,
  getQueryResultContent,
  getQueryRuns,
  getReportQueries,
  streamQueryResultAndAggregate,
} from "../mode";
import type { ModeRowAggregator } from "../mode-config";

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

  it("rejects malformed report-run envelopes before they enter app logic", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ _embedded: { report_runs: {} } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getLatestRun("report-token")).rejects.toThrow(
      /mode returned malformed report_runs_envelope/i,
    );

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ExternalValidationError",
        boundary: "report_runs_envelope",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "mode",
          validation_boundary: "report_runs_envelope",
          validation_source: "mode",
        }),
        extra: expect.objectContaining({
          path: "/reports/report-token/runs",
        }),
      }),
    );
  });

  it("rejects malformed query_runs envelopes before they enter sync logic", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ _embedded: { query_runs: [{ token: "qr-1" }] } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getQueryRuns("report-token", "run-token")).rejects.toThrow(
      /mode returned malformed query_runs_envelope/i,
    );

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ExternalValidationError",
        boundary: "query_runs_envelope",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "mode",
          validation_boundary: "query_runs_envelope",
          validation_source: "mode",
        }),
        extra: expect.objectContaining({
          path: "/reports/report-token/runs/run-token/query_runs",
        }),
      }),
    );
  });

  it("rejects malformed report_queries envelopes before they reach sync logic", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ _embedded: { queries: [{ token: "q-1" }] } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(getReportQueries("report-token")).rejects.toThrow(
      /mode returned malformed report_queries_envelope/i,
    );

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ExternalValidationError",
        boundary: "report_queries_envelope",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "mode",
          validation_boundary: "report_queries_envelope",
          validation_source: "mode",
        }),
        extra: expect.objectContaining({
          path: "/reports/report-token/queries",
        }),
      }),
    );
  });

  it("rejects malformed query result payloads before they reach sync storage", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ revenue: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getQueryResultContent("report-token", "run-token", "query-run-token"),
    ).rejects.toThrow(/mode returned malformed query_result_rows/i);

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ExternalValidationError",
        boundary: "query_result_rows",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          integration: "mode",
          validation_boundary: "query_result_rows",
          validation_source: "mode",
        }),
        extra: expect.objectContaining({
          path: "/reports/report-token/runs/run-token/query_runs/query-run-token/results/content.json?limit=1000",
        }),
      }),
    );
  });

  it("fails Mode health checks on timeout without retrying", async () => {
    const fetchMock = vi.fn((_input, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const promise = checkModeHealth();
    const rejection = expect(promise).rejects.toThrow("Mode health check timed out");

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamQueryResultAndAggregate", () => {
  const originalToken = process.env.MODE_API_TOKEN;
  const originalSecret = process.env.MODE_API_SECRET;
  const originalWorkspace = process.env.MODE_WORKSPACE;

  beforeEach(() => {
    process.env.MODE_API_TOKEN = "mode-token";
    process.env.MODE_API_SECRET = "mode-secret";
    process.env.MODE_WORKSPACE = "cleoai";
  });

  afterEach(() => {
    process.env.MODE_API_TOKEN = originalToken;
    process.env.MODE_API_SECRET = originalSecret;
    process.env.MODE_WORKSPACE = originalWorkspace;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockCaptureException.mockClear();
  });

  type SumState = { count: number; total: number };
  const sumAggregator: ModeRowAggregator<SumState> = {
    initial: () => ({ count: 0, total: 0 }),
    reduce: (state, row) => {
      const v = Number(row.value);
      if (Number.isFinite(v)) {
        state.count += 1;
        state.total += v;
      }
      return state;
    },
    finalize: (state) => [{ count: state.count, total: state.total }],
    columns: [
      { name: "count", type: "number" },
      { name: "total", type: "number" },
    ],
  };

  function csvResponse(body: string): Response {
    const encoded = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split into multiple chunks to exercise the streaming parser.
        const chunkSize = 16;
        for (let i = 0; i < encoded.length; i += chunkSize) {
          controller.enqueue(encoded.subarray(i, i + chunkSize));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  }

  it("parses streaming CSV and feeds rows through the aggregator", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      csvResponse('"id","value"\n"a",1\n"b",2\n"c",3\n'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamQueryResultAndAggregate(
      "report-token",
      "run-token",
      "query-run-token",
      sumAggregator,
    );

    expect(result.rows).toEqual([{ count: 3, total: 6 }]);
    expect(result.sourceRowCount).toBe(3);
    expect(result.responseBytes).toBeGreaterThan(0);
  });

  it("handles quoted fields with embedded commas, newlines and escaped quotes", async () => {
    const collected: Record<string, string>[] = [];
    const collector: ModeRowAggregator<Record<string, string>[]> = {
      initial: () => collected,
      reduce: (state, row) => {
        state.push({ ...row });
        return state;
      },
      finalize: (state) => state.map((row) => ({ ...row })),
    };

    const csv =
      '"id","note"\r\n' +
      '"1","hello, world"\r\n' +
      '"2","line\nbreak"\r\n' +
      '"3","a ""quoted"" word"\r\n';
    const fetchMock = vi.fn().mockResolvedValueOnce(csvResponse(csv));
    vi.stubGlobal("fetch", fetchMock);

    const result = await streamQueryResultAndAggregate(
      "report-token",
      "run-token",
      "query-run-token",
      collector,
    );

    expect(result.rows).toEqual([
      { id: "1", note: "hello, world" },
      { id: "2", note: "line\nbreak" },
      { id: "3", note: 'a "quoted" word' },
    ]);
    expect(result.sourceRowCount).toBe(3);
  });

  it("requests the CSV endpoint with text/csv accept header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csvResponse('"value"\n1\n'));
    vi.stubGlobal("fetch", fetchMock);

    await streamQueryResultAndAggregate(
      "rep",
      "run",
      "qr",
      sumAggregator,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://app.mode.com/api/cleoai/reports/rep/runs/run/query_runs/qr/results/content.csv",
    );
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({
      Accept: "text/csv",
    });
  });

  it("throws when the CSV stream has no header row", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(csvResponse(""));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamQueryResultAndAggregate(
        "report-token",
        "run-token",
        "query-run-token",
        sumAggregator,
      ),
    ).rejects.toThrow("Mode CSV stream contained no header row");
  });
});
