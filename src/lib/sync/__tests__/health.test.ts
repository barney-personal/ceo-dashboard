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

  it("passes a 7-day window start to the query", async () => {
    mockExecute.mockResolvedValue([]);
    const now = new Date("2026-04-17T12:00:00.000Z");

    await getSourceHealth(now);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlArg = mockExecute.mock.calls[0][0] as {
      queryChunks: unknown[];
    };
    const boundWindowStart = sqlArg.queryChunks.find(
      (v): v is Date => v instanceof Date
    );
    expect(boundWindowStart).toBeInstanceOf(Date);
    expect(boundWindowStart!.toISOString()).toBe("2026-04-10T12:00:00.000Z");
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
