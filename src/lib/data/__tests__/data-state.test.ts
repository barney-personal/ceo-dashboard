import { describe, expect, it } from "vitest";
import { resolveDataState, safeLoad } from "../data-state";
import { DatabaseUnavailableError } from "@/lib/db/errors";

const HOUR_MS = 60 * 60 * 1000;

describe("resolveDataState", () => {
  const baseNow = new Date("2026-04-17T12:00:00Z");

  it("returns unavailable when the loader threw DatabaseUnavailableError", () => {
    const error = new DatabaseUnavailableError("DB down");
    const result = resolveDataState({
      source: "mode",
      hasData: true,
      latestSyncRun: {
        status: "success",
        completedAt: new Date(baseNow.getTime() - HOUR_MS),
      },
      error,
      now: baseNow,
    });

    expect(result.kind).toBe("unavailable");
    expect(result.source).toBe("mode");
    expect(result.lastSyncedAt).toEqual(new Date(baseNow.getTime() - HOUR_MS));
  });

  it("returns empty when there is no data and no sync run", () => {
    const result = resolveDataState({
      source: "mode",
      hasData: false,
      latestSyncRun: null,
      now: baseNow,
    });

    expect(result.kind).toBe("empty");
    expect(result.lastSyncedAt).toBeNull();
  });

  it("returns empty when there is no data even if an old sync exists", () => {
    const result = resolveDataState({
      source: "mode",
      hasData: false,
      latestSyncRun: {
        status: "success",
        completedAt: new Date(baseNow.getTime() - 30 * 24 * HOUR_MS),
      },
      now: baseNow,
    });

    expect(result.kind).toBe("empty");
  });

  it("returns stale when data exists but sync is older than 2x normalIntervalMs", () => {
    // Mode normalIntervalMs = 4h. 2x = 8h. Last sync 9h ago → stale.
    const result = resolveDataState({
      source: "mode",
      hasData: true,
      latestSyncRun: {
        status: "success",
        completedAt: new Date(baseNow.getTime() - 9 * HOUR_MS),
      },
      now: baseNow,
    });

    expect(result.kind).toBe("stale");
    expect(result.staleAfter).toBeInstanceOf(Date);
  });

  it("returns ok when data exists and sync is recent", () => {
    const result = resolveDataState({
      source: "mode",
      hasData: true,
      latestSyncRun: {
        status: "success",
        completedAt: new Date(baseNow.getTime() - 2 * HOUR_MS),
      },
      now: baseNow,
    });

    expect(result.kind).toBe("ok");
    expect(result.staleAfter).toBeNull();
  });

  it("unavailable takes precedence over empty", () => {
    const result = resolveDataState({
      source: "slack",
      hasData: false,
      latestSyncRun: null,
      error: new DatabaseUnavailableError("still down"),
      now: baseNow,
    });

    expect(result.kind).toBe("unavailable");
  });

  it("uses the source-specific normalIntervalMs", () => {
    // Slack normalIntervalMs = 2h, 2x = 4h. 5h old → stale.
    const staleResult = resolveDataState({
      source: "slack",
      hasData: true,
      latestSyncRun: {
        status: "success",
        completedAt: new Date(baseNow.getTime() - 5 * HOUR_MS),
      },
      now: baseNow,
    });
    expect(staleResult.kind).toBe("stale");

    // 3h old → still ok.
    const okResult = resolveDataState({
      source: "slack",
      hasData: true,
      latestSyncRun: {
        status: "success",
        completedAt: new Date(baseNow.getTime() - 3 * HOUR_MS),
      },
      now: baseNow,
    });
    expect(okResult.kind).toBe("ok");
  });
});

describe("safeLoad", () => {
  it("returns data with null error when the loader resolves", async () => {
    const result = await safeLoad(() => Promise.resolve(42), 0);

    expect(result.data).toBe(42);
    expect(result.error).toBeNull();
  });

  it("returns fallback with error when the loader throws DatabaseUnavailableError", async () => {
    const error = new DatabaseUnavailableError("unreachable");
    const result = await safeLoad<number>(() => Promise.reject(error), -1);

    expect(result.data).toBe(-1);
    expect(result.error).toBe(error);
  });

  it("rethrows non-DB errors", async () => {
    const other = new Error("parse failed");
    await expect(
      safeLoad<number>(() => Promise.reject(other), -1),
    ).rejects.toBe(other);
  });
});
