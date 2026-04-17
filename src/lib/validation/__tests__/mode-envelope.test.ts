import { describe, expect, it } from "vitest";
import {
  modeReportRunsEnvelopeSchema,
  modeQueryRunsEnvelopeSchema,
  modeQueriesEnvelopeSchema,
  ModeEnvelopeValidationError,
} from "../mode-envelope";

describe("modeReportRunsEnvelopeSchema", () => {
  it("accepts a valid report_runs envelope", () => {
    const valid = {
      _embedded: {
        report_runs: [
          { token: "run-1", state: "succeeded", created_at: "2026-04-09T12:00:00Z" },
        ],
      },
      _links: { self: { href: "/some/path" } },
    };

    const result = modeReportRunsEnvelopeSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data._embedded.report_runs).toHaveLength(1);
      expect(result.data._embedded.report_runs[0].token).toBe("run-1");
    }
  });

  it("accepts an empty report_runs array", () => {
    const result = modeReportRunsEnvelopeSchema.safeParse({
      _embedded: { report_runs: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when _embedded is missing", () => {
    const result = modeReportRunsEnvelopeSchema.safeParse({ data: [] });
    expect(result.success).toBe(false);
  });

  it("rejects when report_runs is not an array", () => {
    const result = modeReportRunsEnvelopeSchema.safeParse({
      _embedded: { report_runs: "not-array" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when a run is missing required fields", () => {
    const result = modeReportRunsEnvelopeSchema.safeParse({
      _embedded: {
        report_runs: [{ token: "run-1" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when token is empty string", () => {
    const result = modeReportRunsEnvelopeSchema.safeParse({
      _embedded: {
        report_runs: [{ token: "", state: "succeeded", created_at: "2026-01-01" }],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("modeQueryRunsEnvelopeSchema", () => {
  it("accepts a valid query_runs envelope", () => {
    const valid = {
      _embedded: {
        query_runs: [
          {
            token: "qr-1",
            state: "succeeded",
            _links: {
              query: { href: "/api/ws/reports/r1/queries/q1" },
              result: { href: "/api/ws/reports/r1/runs/run1/query_runs/qr-1/results" },
            },
          },
        ],
      },
    };

    const result = modeQueryRunsEnvelopeSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects when _links.query.href is missing", () => {
    const result = modeQueryRunsEnvelopeSchema.safeParse({
      _embedded: {
        query_runs: [
          {
            token: "qr-1",
            state: "succeeded",
            _links: {
              result: { href: "/result" },
            },
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a completely malformed object", () => {
    const result = modeQueryRunsEnvelopeSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it("rejects null", () => {
    const result = modeQueryRunsEnvelopeSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

describe("modeQueriesEnvelopeSchema", () => {
  it("accepts a valid queries envelope", () => {
    const valid = {
      _embedded: {
        queries: [{ token: "q-1", name: "Revenue" }],
      },
    };

    const result = modeQueriesEnvelopeSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a query with empty name", () => {
    const result = modeQueriesEnvelopeSchema.safeParse({
      _embedded: { queries: [{ token: "q-1", name: "" }] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when queries array contains item with empty token", () => {
    const result = modeQueriesEnvelopeSchema.safeParse({
      _embedded: { queries: [{ token: "", name: "Revenue" }] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects when _embedded.queries is missing", () => {
    const result = modeQueriesEnvelopeSchema.safeParse({
      _embedded: { other: [] },
    });
    expect(result.success).toBe(false);
  });
});

describe("ModeEnvelopeValidationError", () => {
  it("has correct name and properties", () => {
    const error = new ModeEnvelopeValidationError("report_runs", "token: Required");
    expect(error.name).toBe("ModeEnvelopeValidationError");
    expect(error.envelope).toBe("report_runs");
    expect(error.issues).toBe("token: Required");
    expect(error.message).toContain("report_runs");
  });
});
