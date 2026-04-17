import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/request-auth", () => ({
  isCronRequest: vi.fn(),
}));

vi.mock("@/lib/sync/coordinator", () => ({
  enqueueSyncRun: vi.fn(),
}));

vi.mock("@/lib/sync/runtime", () => ({
  createWorkerId: vi.fn(),
  startBackgroundSyncDrain: vi.fn(),
  awaitDrainStarted: vi.fn(),
}));

import { isCronRequest } from "@/lib/sync/request-auth";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import {
  awaitDrainStarted,
  createWorkerId,
  startBackgroundSyncDrain,
} from "@/lib/sync/runtime";
import { GET } from "../route";

const mockIsCronRequest = vi.mocked(isCronRequest);
const mockEnqueueSyncRun = vi.mocked(enqueueSyncRun);
const mockCreateWorkerId = vi.mocked(createWorkerId);
const mockStartBackgroundSyncDrain = vi.mocked(startBackgroundSyncDrain);
const mockAwaitDrainStarted = vi.mocked(awaitDrainStarted);
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

function makeRequest(authHeader?: string) {
  return new Request("http://localhost/api/cron", {
    headers: authHeader ? { authorization: authHeader } : {},
  }) as unknown as import("next/server").NextRequest;
}

function drainHandle() {
  return { started: Promise.resolve() };
}

describe("GET /api/cron", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateWorkerId.mockImplementation((label) => label);
    mockStartBackgroundSyncDrain.mockImplementation(() => drainHandle());
    mockAwaitDrainStarted.mockResolvedValue("started");
    consoleErrorSpy.mockImplementation(() => {});
  });

  it("returns 401 when the request is not signed with the cron secret", async () => {
    mockIsCronRequest.mockResolvedValue(false);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockEnqueueSyncRun).not.toHaveBeenCalled();
  });

  it("serializes queued, skipped, and forced results consistently", async () => {
    mockIsCronRequest.mockResolvedValue(true);
    mockEnqueueSyncRun
      .mockResolvedValueOnce({
        outcome: "queued",
        runId: 1,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T08:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "skipped",
        runId: 2,
        reason: "within_interval",
        nextEligibleAt: new Date("2026-04-08T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "forced",
        runId: 3,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T09:30:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "queued",
        runId: 4,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T10:30:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "skipped",
        runId: null,
        reason: "within_interval",
        nextEligibleAt: new Date("2026-04-08T12:00:00.000Z"),
      });

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(mockEnqueueSyncRun).toHaveBeenNthCalledWith(1, "mode", {
      trigger: "cron",
    });
    expect(mockEnqueueSyncRun).toHaveBeenNthCalledWith(2, "slack", {
      trigger: "cron",
    });
    expect(mockEnqueueSyncRun).toHaveBeenNthCalledWith(
      3,
      "management-accounts",
      {
        trigger: "cron",
      }
    );
    expect(mockEnqueueSyncRun).toHaveBeenNthCalledWith(4, "meetings", {
      trigger: "cron",
    });
    expect(mockEnqueueSyncRun).toHaveBeenNthCalledWith(5, "github", {
      trigger: "cron",
    });
    expect(mockCreateWorkerId).toHaveBeenCalledWith("web-cron");
    expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith("web-cron", {
      runIds: [1, 2, 3, 4],
      triggerLabel: "cron trigger",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "syncs enqueued",
      drain_started: true,
      results: {
        mode: {
          outcome: "queued",
          runId: 1,
          reason: null,
          nextEligibleAt: "2026-04-08T08:00:00.000Z",
        },
        slack: {
          outcome: "skipped",
          runId: 2,
          reason: "within_interval",
          nextEligibleAt: "2026-04-08T10:00:00.000Z",
        },
        managementAccounts: {
          outcome: "forced",
          runId: 3,
          reason: null,
          nextEligibleAt: "2026-04-08T09:30:00.000Z",
        },
        meetings: {
          outcome: "queued",
          runId: 4,
          reason: null,
          nextEligibleAt: "2026-04-08T10:30:00.000Z",
        },
        github: {
          outcome: "skipped",
          runId: null,
          reason: "within_interval",
          nextEligibleAt: "2026-04-08T12:00:00.000Z",
        },
      },
    });
  });

  it("returns drain_started:'pending' when the first claim does not settle before the timeout", async () => {
    mockIsCronRequest.mockResolvedValue(true);
    mockEnqueueSyncRun.mockResolvedValue({
      outcome: "queued",
      runId: 1,
      reason: null,
      nextEligibleAt: new Date("2026-04-08T08:00:00.000Z"),
    });
    mockAwaitDrainStarted.mockResolvedValue("pending");

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.drain_started).toBe("pending");
  });

  it("returns 503 with drain_started:false when the background drain fails to start", async () => {
    mockIsCronRequest.mockResolvedValue(true);
    mockEnqueueSyncRun.mockResolvedValue({
      outcome: "queued",
      runId: 7,
      reason: null,
      nextEligibleAt: new Date("2026-04-08T08:00:00.000Z"),
    });
    mockAwaitDrainStarted.mockResolvedValue("failed");

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.drain_started).toBe(false);
    expect(body.status).toBe("sync drain failed to start");
    expect(body.results).toBeTruthy();
  });

  it("does not start the worker when every sync is skipped", async () => {
    mockIsCronRequest.mockResolvedValue(true);
    mockEnqueueSyncRun.mockResolvedValue({
      outcome: "skipped",
      runId: 4,
      reason: "within_interval",
      nextEligibleAt: new Date("2026-04-08T11:00:00.000Z"),
    });

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(mockStartBackgroundSyncDrain).not.toHaveBeenCalled();
    expect(mockAwaitDrainStarted).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.drain_started).toBeUndefined();
  });

  it("returns 500 when cron auth lookup throws unexpectedly", async () => {
    const error = new Error("clerk offline");
    mockIsCronRequest.mockRejectedValue(error);

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[sync-api] unexpected cron route error",
      error
    );
  });

  it("returns 500 when enqueueing syncs throws unexpectedly", async () => {
    const error = new Error("db unavailable");
    mockIsCronRequest.mockResolvedValue(true);
    mockEnqueueSyncRun.mockRejectedValue(error);

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[sync-api] unexpected cron route error",
      error
    );
  });

  it("returns 500 when background worker startup throws unexpectedly", async () => {
    const error = new Error("worker startup failed");
    mockIsCronRequest.mockResolvedValue(true);
    mockEnqueueSyncRun
      .mockResolvedValueOnce({
        outcome: "queued",
        runId: 1,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T08:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "skipped",
        runId: null,
        reason: "within_interval",
        nextEligibleAt: new Date("2026-04-08T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "forced",
        runId: 3,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T09:30:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "skipped",
        runId: null,
        reason: "within_interval",
        nextEligibleAt: new Date("2026-04-08T11:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        outcome: "skipped",
        runId: null,
        reason: "within_interval",
        nextEligibleAt: new Date("2026-04-08T12:00:00.000Z"),
      });
    mockStartBackgroundSyncDrain.mockImplementation(() => {
      throw error;
    });

    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[sync-api] unexpected cron route error",
      error
    );
  });
});
