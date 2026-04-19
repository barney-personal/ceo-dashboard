import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { execute: mockExecute },
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import {
  detectStalledSources,
  emitStalledSourceWarnings,
  getSourceHealth,
  type SourceHealth,
} from "../health";

const mockCaptureMessage = vi.mocked(Sentry.captureMessage);

beforeEach(() => {
  mockExecute.mockReset();
  mockCaptureMessage.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSourceHealth", () => {
  it("returns a row per known SyncSource, filling zeros for unseen sources", async () => {
    mockExecute.mockResolvedValue([
      {
        source: "mode",
        last_success_at: "2026-04-17T10:00:00.000Z",
        last_failure_at: "2026-04-17T09:00:00.000Z",
        total_runs: 10,
        success_runs: 9,
        p95_duration_ms: "12500",
      },
      {
        source: "slack",
        last_success_at: "2026-04-17T10:30:00.000Z",
        last_failure_at: null,
        total_runs: 8,
        success_runs: 8,
        p95_duration_ms: "3200.5",
      },
    ]);

    const healths = await getSourceHealth(new Date("2026-04-17T12:00:00.000Z"));

    expect(healths).toHaveLength(5);
    const bySource = Object.fromEntries(healths.map((h) => [h.source, h]));

    expect(bySource.mode).toEqual<SourceHealth>({
      source: "mode",
      lastSuccessAt: new Date("2026-04-17T10:00:00.000Z"),
      lastFailureAt: new Date("2026-04-17T09:00:00.000Z"),
      totalRuns7d: 10,
      successRuns7d: 9,
      successRate7d: 0.9,
      p95DurationMs: 12500,
    });
    expect(bySource.slack.successRate7d).toBe(1);
    expect(bySource.slack.p95DurationMs).toBe(3200.5);
    expect(bySource["management-accounts"]).toEqual<SourceHealth>({
      source: "management-accounts",
      lastSuccessAt: null,
      lastFailureAt: null,
      totalRuns7d: 0,
      successRuns7d: 0,
      successRate7d: null,
      p95DurationMs: null,
    });
    expect(bySource.meetings.successRate7d).toBeNull();
    expect(bySource.github.lastSuccessAt).toBeNull();
  });

  it("passes a 7-day window start (as ISO string) to the query", async () => {
    // postgres-js rejects raw Date params in drizzle sql templates; we
    // serialize the window start to ISO + cast to timestamptz server-side.
    mockExecute.mockResolvedValue([]);
    const now = new Date("2026-04-17T12:00:00.000Z");

    await getSourceHealth(now);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlArg = mockExecute.mock.calls[0][0] as object;
    // Compile the SQL to get the actual bound param list.
    const compiled = (sqlArg as { getSQL: () => { toQuery: (config: unknown) => { params: unknown[] } } })
      .getSQL()
      .toQuery({ escapeName: (v: string) => `"${v}"`, escapeParam: (i: number) => `$${i + 1}`, escapeString: (v: string) => `'${v}'` });
    // Must include the ISO string, and must NOT include a raw Date — that's the
    // exact regression: postgres-js rejects Date instances as query params.
    expect(compiled.params).toContain("2026-04-10T12:00:00.000Z");
    expect(compiled.params.some((v) => v instanceof Date)).toBe(false);
  });

  it("returns lastSuccessAt / lastFailureAt even when they are older than the 7-day window", async () => {
    // Source broke 10 days ago — no runs in the 7-day window but the historical
    // last_success_at must still be surfaced so the UI doesn't say "never".
    mockExecute.mockResolvedValue([
      {
        source: "mode",
        last_success_at: "2026-04-07T09:00:00.000Z", // 10 days before `now`
        last_failure_at: "2026-04-08T09:00:00.000Z", // 9 days before `now`
        total_runs: 0,
        success_runs: 0,
        p95_duration_ms: null,
      },
    ]);

    const healths = await getSourceHealth(new Date("2026-04-17T12:00:00.000Z"));
    const mode = healths.find((h) => h.source === "mode")!;

    expect(mode.lastSuccessAt).toEqual(new Date("2026-04-07T09:00:00.000Z"));
    expect(mode.lastFailureAt).toEqual(new Date("2026-04-08T09:00:00.000Z"));
    expect(mode.totalRuns7d).toBe(0);
    expect(mode.successRuns7d).toBe(0);
    expect(mode.successRate7d).toBeNull();
    expect(mode.p95DurationMs).toBeNull();
  });

  it("ignores rows with unknown source names", async () => {
    mockExecute.mockResolvedValue([
      {
        source: "surprise",
        last_success_at: "2026-04-17T10:00:00.000Z",
        last_failure_at: null,
        total_runs: 3,
        success_runs: 3,
        p95_duration_ms: 1000,
      },
    ]);

    const healths = await getSourceHealth(new Date("2026-04-17T12:00:00.000Z"));
    for (const h of healths) {
      expect(h.lastSuccessAt).toBeNull();
      expect(h.totalRuns7d).toBe(0);
    }
  });
});

describe("detectStalledSources", () => {
  it("flags sources whose last success is older than 5x their normal interval", () => {
    const now = new Date("2026-04-17T12:00:00.000Z");
    const healths: SourceHealth[] = [
      {
        source: "mode",
        // mode normalIntervalMs = 4h -> stalled threshold = 20h
        lastSuccessAt: new Date("2026-04-16T10:00:00.000Z"), // 26h ago
        lastFailureAt: null,
        totalRuns7d: 1,
        successRuns7d: 1,
        successRate7d: 1,
        p95DurationMs: 1000,
      },
      {
        source: "slack",
        // slack normalIntervalMs = 2h -> stalled threshold = 10h
        lastSuccessAt: new Date("2026-04-17T09:00:00.000Z"), // 3h ago
        lastFailureAt: null,
        totalRuns7d: 1,
        successRuns7d: 1,
        successRate7d: 1,
        p95DurationMs: 500,
      },
      {
        source: "management-accounts",
        lastSuccessAt: null,
        lastFailureAt: null,
        totalRuns7d: 0,
        successRuns7d: 0,
        successRate7d: null,
        p95DurationMs: null,
      },
      {
        source: "meetings",
        // meetings normalIntervalMs = 2h -> threshold = 10h
        lastSuccessAt: new Date("2026-04-17T01:00:00.000Z"), // 11h ago
        lastFailureAt: null,
        totalRuns7d: 1,
        successRuns7d: 1,
        successRate7d: 1,
        p95DurationMs: 1000,
      },
      {
        source: "github",
        lastSuccessAt: new Date("2026-04-17T10:00:00.000Z"), // 2h ago
        lastFailureAt: null,
        totalRuns7d: 1,
        successRuns7d: 1,
        successRate7d: 1,
        p95DurationMs: 1000,
      },
    ];

    const stalled = detectStalledSources(healths, now);
    expect(stalled.map((s) => s.source).sort()).toEqual([
      "meetings",
      "mode",
    ]);
    const modeEntry = stalled.find((s) => s.source === "mode")!;
    expect(modeEntry.thresholdMs).toBe(5 * 4 * 60 * 60 * 1000);
    expect(modeEntry.ageMs).toBeGreaterThan(modeEntry.thresholdMs);
  });

  it("still flags a source whose last success is older than the 7-day stats window", () => {
    // Regression guard: M8 originally scoped `lastSuccessAt` to the last 7 days,
    // which silently dropped stalled-source warnings past day 7. The stalled
    // detector must keep firing as long as the historical last success is stale.
    const now = new Date("2026-04-17T12:00:00.000Z");
    const healths: SourceHealth[] = [
      {
        source: "mode",
        // last success 10 days ago — well past the 7-day stats window AND
        // well past the 20h stalled threshold for mode.
        lastSuccessAt: new Date("2026-04-07T12:00:00.000Z"),
        lastFailureAt: new Date("2026-04-16T12:00:00.000Z"),
        totalRuns7d: 0,
        successRuns7d: 0,
        successRate7d: null,
        p95DurationMs: null,
      },
    ];

    const stalled = detectStalledSources(healths, now);
    expect(stalled).toHaveLength(1);
    expect(stalled[0]?.source).toBe("mode");
    expect(stalled[0]?.ageMs).toBeGreaterThan(stalled[0]!.thresholdMs);
  });

  it("never flags a source that has never succeeded", () => {
    const healths: SourceHealth[] = [
      {
        source: "slack",
        lastSuccessAt: null,
        lastFailureAt: new Date("2026-04-16T09:00:00.000Z"),
        totalRuns7d: 5,
        successRuns7d: 0,
        successRate7d: 0,
        p95DurationMs: null,
      },
    ];

    expect(detectStalledSources(healths, new Date())).toEqual([]);
  });
});

describe("emitStalledSourceWarnings", () => {
  it("emits one Sentry warning per stalled source with the sync_stalled tag", () => {
    emitStalledSourceWarnings([
      {
        source: "mode",
        lastSuccessAt: new Date("2026-04-16T10:00:00.000Z"),
        thresholdMs: 20 * 60 * 60 * 1000,
        ageMs: 26 * 60 * 60 * 1000,
      },
      {
        source: "meetings",
        lastSuccessAt: new Date("2026-04-17T01:00:00.000Z"),
        thresholdMs: 10 * 60 * 60 * 1000,
        ageMs: 11 * 60 * 60 * 1000,
      },
    ]);

    expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
    expect(mockCaptureMessage).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`Sync source "mode"`),
      expect.objectContaining({
        level: "warning",
        tags: { sync_stalled: "true", source: "mode" },
        extra: expect.objectContaining({
          source: "mode",
          lastSuccessAt: "2026-04-16T10:00:00.000Z",
          thresholdMs: 20 * 60 * 60 * 1000,
          ageMs: 26 * 60 * 60 * 1000,
        }),
      })
    );
    expect(mockCaptureMessage).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`Sync source "meetings"`),
      expect.objectContaining({
        tags: { sync_stalled: "true", source: "meetings" },
      })
    );
  });

  it("no-ops when the list is empty", () => {
    emitStalledSourceWarnings([]);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});
