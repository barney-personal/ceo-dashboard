// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadManifest, resolveChecks, formatSummaryName, postResult } from "../../probe";
import type { CheckContext } from "../../probe";
import type { CheckResult } from "../report";
import { renderMarkdown } from "../report";
import type { ProbeReport } from "../report";
import { resolve } from "path";

const MANIFEST_PATH = resolve(__dirname, "../manifest.yaml");

describe("probe CLI contract", () => {
  describe("formatSummaryName", () => {
    it("maps --all to probe-all for machine-readable output", () => {
      expect(formatSummaryName("--all")).toBe("probe-all");
    });

    it("preserves suite names", () => {
      expect(formatSummaryName("ceo-15m-suite")).toBe("ceo-15m-suite");
    });

    it("preserves individual check names", () => {
      expect(formatSummaryName("ceo-ping-auth")).toBe("ceo-ping-auth");
    });
  });

  describe("resolveChecks", () => {
    it("resolves --all to every check in manifest", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      const checks = resolveChecks(manifest, "--all");
      expect(checks).toEqual(expect.arrayContaining(["ceo-ping-auth"]));
      expect(checks).toHaveLength(Object.keys(manifest.checks).length);
    });

    it("resolves a suite to its check list", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      const checks = resolveChecks(manifest, "ceo-15m-suite");
      expect(checks).toEqual(["ceo-ping-auth"]);
    });

    it("resolves a single check name to itself", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      const checks = resolveChecks(manifest, "ceo-ping-auth");
      expect(checks).toEqual(["ceo-ping-auth"]);
    });

    it("throws on unknown name", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      expect(() => resolveChecks(manifest, "nonexistent")).toThrow(
        /Unknown check or suite/
      );
    });
  });

  describe("loadManifest", () => {
    it("loads and parses the YAML manifest", () => {
      const manifest = loadManifest(MANIFEST_PATH);
      expect(manifest.suites).toBeDefined();
      expect(manifest.checks).toBeDefined();
      expect(manifest.checks["ceo-ping-auth"]).toMatchObject({
        handler: expect.any(String),
        timeout_ms: expect.any(Number),
      });
    });

    it("throws on missing file", () => {
      expect(() => loadManifest("/nonexistent/path.yaml")).toThrow();
    });
  });

  describe("postResult delivery tracking", () => {
    const makeCtx = (): CheckContext => ({
      target: "prod",
      probeSecret: "test-secret",
      baseUrl: "https://example.com",
      sign: () => ({ signature: "sig", ts: 1000 }),
    });

    const greenResult: CheckResult = {
      checkName: "ceo-ping-auth",
      status: "green",
      latencyMs: 42,
    };

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns ok: true when POST succeeds with 200", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      const result = await postResult(greenResult, makeCtx(), "run-1");
      expect(result).toEqual({ ok: true });
    });

    it("returns ok: false with error when POST returns non-ok status", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });
      const result = await postResult(greenResult, makeCtx(), "run-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/401/);
      }
    });

    it("returns ok: false with error when fetch throws network error", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      const result = await postResult(greenResult, makeCtx(), "run-1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/ECONNREFUSED/);
      }
    });

    it("sends correct payload shape and headers", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      await postResult(greenResult, makeCtx(), "run-123");
      const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("https://example.com/api/probes/report");
      expect(opts.method).toBe("POST");
      expect(opts.headers["X-Probe-Signature"]).toBe("sig");
      expect(opts.headers["X-Probe-Timestamp"]).toBe("1000");
      const body = JSON.parse(opts.body);
      expect(body.checkName).toBe("ceo-ping-auth");
      expect(body.runId).toBe("run-123");
    });

    // Regression: CheckResult.error used to be dropped from the POST payload
    // because the report endpoint only reads `details`. The dashboard then
    // showed red runs with no failure message. postResult now folds
    // `error` into `details.error` so it survives ingestion.
    it("folds CheckResult.error into details.error so it reaches the DB", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      const redResult: CheckResult = {
        checkName: "ceo-ping-auth",
        status: "red",
        latencyMs: 1200,
        error: "connection refused",
        details: { url: "https://example.com/api/probes/ping-auth" },
      };
      await postResult(redResult, makeCtx(), "run-err");
      const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.details).toEqual({
        url: "https://example.com/api/probes/ping-auth",
        error: "connection refused",
      });
    });

    it("folds error into a fresh details object when no details were provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      const redResult: CheckResult = {
        checkName: "ceo-ping-auth",
        status: "red",
        latencyMs: 800,
        error: "timeout",
      };
      await postResult(redResult, makeCtx(), "run-err-2");
      const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.details).toEqual({ error: "timeout" });
    });

    it("leaves details untouched when CheckResult has no error", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      const greenWithDetails: CheckResult = {
        checkName: "ceo-ping-auth",
        status: "green",
        latencyMs: 42,
        details: { db_ok: true },
      };
      await postResult(greenWithDetails, makeCtx(), "run-green");
      const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.details).toEqual({ db_ok: true });
    });
  });

  describe("renderMarkdown with delivery failures", () => {
    const baseReport: ProbeReport = {
      suite: "ceo-15m-suite",
      target: "prod",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:00:05Z"),
      results: [
        { checkName: "ceo-ping-auth", status: "green", latencyMs: 42 },
      ],
      gitSha: "abc1234",
    };

    it("includes delivery failures section when present", () => {
      const report: ProbeReport = {
        ...baseReport,
        deliveryFailures: [
          { checkName: "ceo-ping-auth", error: "401 Unauthorized" },
        ],
      };
      const md = renderMarkdown(report);
      expect(md).toContain("Delivery Failures");
      expect(md).toContain("ceo-ping-auth");
      expect(md).toContain("401 Unauthorized");
    });

    it("omits delivery failures section when empty", () => {
      const report: ProbeReport = {
        ...baseReport,
        deliveryFailures: [],
      };
      const md = renderMarkdown(report);
      expect(md).not.toContain("Delivery Failures");
    });

    it("omits delivery failures section when undefined", () => {
      const md = renderMarkdown(baseReport);
      expect(md).not.toContain("Delivery Failures");
    });
  });
});
