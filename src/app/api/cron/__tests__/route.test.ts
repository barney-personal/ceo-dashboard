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
}));

import { isCronRequest } from "@/lib/sync/request-auth";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import { createWorkerId, startBackgroundSyncDrain } from "@/lib/sync/runtime";
import { GET } from "../route";

const mockIsCronRequest = vi.mocked(isCronRequest);
const mockEnqueueSyncRun = vi.mocked(enqueueSyncRun);
const mockCreateWorkerId = vi.mocked(createWorkerId);
const mockStartBackgroundSyncDrain = vi.mocked(startBackgroundSyncDrain);

function makeRequest(authHeader?: string) {
  return new Request("http://localhost/api/cron", {
    headers: authHeader ? { authorization: authHeader } : {},
  }) as unknown as import("next/server").NextRequest;
}

describe("GET /api/cron", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateWorkerId.mockImplementation((label) => label);
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
    expect(mockCreateWorkerId).toHaveBeenCalledWith("web-cron");
    expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith("web-cron", {
      runIds: [1, 2, 3],
      triggerLabel: "cron trigger",
    });
    expect(await response.json()).toEqual({
      status: "syncs enqueued",
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
      },
    });
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
  });
});
