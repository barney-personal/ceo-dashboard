import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/request-auth", () => ({
  authorizeSyncRequest: vi.fn(),
  syncRequestAccessErrorResponse: vi.fn(),
}));

vi.mock("@/lib/sync/coordinator", () => ({
  enqueueSyncRun: vi.fn(),
}));

vi.mock("@/lib/sync/runtime", () => ({
  createWorkerId: vi.fn(),
  startBackgroundSyncDrain: vi.fn(),
  awaitDrainStarted: vi.fn(),
}));

vi.mock("@/lib/sync/mode", () => ({
  validateModeReportSyncTarget: vi.fn(),
}));

import {
  authorizeSyncRequest,
  syncRequestAccessErrorResponse,
} from "@/lib/sync/request-auth";
import { enqueueSyncRun } from "@/lib/sync/coordinator";
import { validateModeReportSyncTarget } from "@/lib/sync/mode";
import {
  awaitDrainStarted,
  createWorkerId,
  startBackgroundSyncDrain,
} from "@/lib/sync/runtime";
import { POST as postManagementAccounts } from "@/app/api/sync/management-accounts/route";
import { POST as postMode } from "@/app/api/sync/mode/route";
import { POST as postModeReport } from "@/app/api/sync/mode/report/route";
import { POST as postSlack } from "@/app/api/sync/slack/route";

const mockAuthorizeSyncRequest = vi.mocked(authorizeSyncRequest);
const mockSyncRequestAccessErrorResponse = vi.mocked(
  syncRequestAccessErrorResponse
);
const mockEnqueueSyncRun = vi.mocked(enqueueSyncRun);
const mockValidateModeReportSyncTarget = vi.mocked(validateModeReportSyncTarget);
const mockCreateWorkerId = vi.mocked(createWorkerId);
const mockStartBackgroundSyncDrain = vi.mocked(startBackgroundSyncDrain);
const mockAwaitDrainStarted = vi.mocked(awaitDrainStarted);

function drainHandle() {
  return { started: Promise.resolve() };
}
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

const routes = [
  {
    name: "mode",
    source: "mode",
    workerId: "web-mode",
    handler: postMode,
    url: "http://localhost/api/sync/mode",
  },
  {
    name: "slack",
    source: "slack",
    workerId: "web-slack",
    handler: postSlack,
    url: "http://localhost/api/sync/slack",
  },
  {
    name: "management-accounts",
    source: "management-accounts",
    workerId: "web-accounts",
    handler: postManagementAccounts,
    url: "http://localhost/api/sync/management-accounts",
  },
] as const;

function makeRequest(url: string, body?: unknown) {
  const request = new Request(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as import("next/server").NextRequest;
  Object.defineProperty(request, "nextUrl", {
    configurable: true,
    value: new URL(url),
  });
  return request;
}

describe("manual sync routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCreateWorkerId.mockImplementation((label) => label);
    mockStartBackgroundSyncDrain.mockImplementation(() => drainHandle());
    mockAwaitDrainStarted.mockResolvedValue("started");
    mockValidateModeReportSyncTarget.mockResolvedValue({
      ok: true,
      report: {
        id: 1,
        reportToken: "report-alpha",
        name: "Alpha Report",
        section: "product",
        category: null,
        isActive: true,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    });
    consoleErrorSpy.mockImplementation(() => {});
    mockSyncRequestAccessErrorResponse.mockImplementation((access) => {
      if (access === "unauthenticated") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (access === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      return null;
    });
  });

  it.each(routes)("returns 401 for unauthenticated $name requests", async ({ handler, url }) => {
    mockAuthorizeSyncRequest.mockResolvedValue("unauthenticated");

    const response = await handler(makeRequest(url));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockEnqueueSyncRun).not.toHaveBeenCalled();
  });

  it.each(routes)("returns 403 for forbidden $name requests", async ({ handler, url }) => {
    mockAuthorizeSyncRequest.mockResolvedValue("forbidden");

    const response = await handler(makeRequest(url));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockEnqueueSyncRun).not.toHaveBeenCalled();
  });

  it.each(routes)(
    "serializes queued $name responses and starts the worker",
    async ({ handler, source, workerId, url }) => {
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockResolvedValue({
        outcome: "queued",
        runId: 17,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T09:00:00.000Z"),
      });

      const response = await handler(makeRequest(url));

      expect(mockEnqueueSyncRun).toHaveBeenCalledWith(source, {
        trigger: "manual",
        force: false,
      });
      expect(mockCreateWorkerId).toHaveBeenCalledWith(workerId);
      expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith(workerId, {
        source,
        runIds: [17],
        triggerLabel: "manual " + source + " sync request",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        outcome: "queued",
        runId: 17,
        reason: null,
        nextEligibleAt: "2026-04-08T09:00:00.000Z",
        drain_started: true,
      });
    }
  );

  it.each(routes)(
    "returns drain_started:'pending' when $name's first claim cycle has not settled in time",
    async ({ handler, source, url }) => {
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockResolvedValue({
        outcome: "queued",
        runId: 71,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T09:00:00.000Z"),
      });
      mockAwaitDrainStarted.mockResolvedValue("pending");

      const response = await handler(makeRequest(url));

      expect(response.status).toBe(200);
      expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source }),
      );
      const body = await response.json();
      expect(body.drain_started).toBe("pending");
    }
  );

  it.each(routes)(
    "returns 503 with drain_started:false when $name's first claim cycle throws",
    async ({ handler, source, url }) => {
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockResolvedValue({
        outcome: "queued",
        runId: 81,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T09:00:00.000Z"),
      });
      mockAwaitDrainStarted.mockResolvedValue("failed");

      const response = await handler(makeRequest(url));

      expect(response.status).toBe(503);
      expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source, runIds: [81] }),
      );
      const body = await response.json();
      expect(body.drain_started).toBe(false);
      expect(body.outcome).toBe("queued");
      expect(body.runId).toBe(81);
    }
  );

  it("returns 400 when the scoped Mode route is missing reportToken", async () => {
    mockAuthorizeSyncRequest.mockResolvedValue("manual");
    mockValidateModeReportSyncTarget.mockResolvedValue({
      ok: false,
      status: 400,
      error: "reportToken is required",
    });

    const response = await postModeReport(makeRequest("http://localhost/api/sync/mode/report", {}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "reportToken is required" });
    expect(mockEnqueueSyncRun).not.toHaveBeenCalled();
    expect(mockStartBackgroundSyncDrain).not.toHaveBeenCalled();
  });

  it("returns 404 when the scoped Mode route gets an unknown token", async () => {
    mockAuthorizeSyncRequest.mockResolvedValue("manual");
    mockValidateModeReportSyncTarget.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Unknown Mode report token "missing-token"',
    });

    const response = await postModeReport(
      makeRequest("http://localhost/api/sync/mode/report", {
        reportToken: "missing-token",
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Unknown Mode report token "missing-token"',
    });
    expect(mockEnqueueSyncRun).not.toHaveBeenCalled();
  });

  it("returns 409 when the scoped Mode route gets an inactive or disabled token", async () => {
    mockAuthorizeSyncRequest.mockResolvedValue("manual");
    mockValidateModeReportSyncTarget.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Mode report "Alpha Report" is inactive',
    });

    const response = await postModeReport(
      makeRequest("http://localhost/api/sync/mode/report", {
        reportToken: "report-alpha",
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Mode report "Alpha Report" is inactive',
    });
    expect(mockEnqueueSyncRun).not.toHaveBeenCalled();
  });

  it("queues a scoped Mode report sync and starts the worker", async () => {
    mockAuthorizeSyncRequest.mockResolvedValue("manual");
    mockEnqueueSyncRun.mockResolvedValue({
      outcome: "queued",
      runId: 44,
      reason: null,
      nextEligibleAt: new Date("2026-04-08T09:00:00.000Z"),
    });

    const response = await postModeReport(
      makeRequest("http://localhost/api/sync/mode/report", {
        reportToken: "report-alpha",
      })
    );

    expect(mockValidateModeReportSyncTarget).toHaveBeenCalledWith(
      "report-alpha"
    );
    expect(mockEnqueueSyncRun).toHaveBeenCalledWith("mode", {
      trigger: "manual",
      force: false,
      scope: { reportToken: "report-alpha" },
    });
    expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith("web-mode", {
      source: "mode",
      runIds: [44],
      triggerLabel: "manual mode report sync request (report-alpha)",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "queued",
      runId: 44,
      reason: null,
      nextEligibleAt: "2026-04-08T09:00:00.000Z",
      drain_started: true,
    });
  });

  it("returns active scope details when a scoped Mode report conflicts with an active full sync", async () => {
    mockAuthorizeSyncRequest.mockResolvedValue("manual");
    mockEnqueueSyncRun.mockResolvedValue({
      outcome: "already-running",
      runId: 52,
      reason: "active_run_exists",
      nextEligibleAt: null,
      activeScopeDescription: "all Mode reports",
    });

    const response = await postModeReport(
      makeRequest("http://localhost/api/sync/mode/report", {
        reportToken: "report-alpha",
      })
    );

    expect(mockStartBackgroundSyncDrain).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      outcome: "already-running",
      runId: 52,
      reason: "active_run_exists",
      nextEligibleAt: null,
      activeScopeDescription: "all Mode reports",
    });
  });

  it.each(routes)(
    "serializes skipped $name responses without starting the worker",
    async ({ handler, source, url }) => {
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockResolvedValue({
        outcome: "skipped",
        runId: 9,
        reason: "within_interval",
        nextEligibleAt: new Date("2026-04-08T12:00:00.000Z"),
      });

      const response = await handler(makeRequest(url));

      expect(mockEnqueueSyncRun).toHaveBeenCalledWith(source, {
        trigger: "manual",
        force: false,
      });
      expect(mockStartBackgroundSyncDrain).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({
        outcome: "skipped",
        runId: 9,
        reason: "within_interval",
        nextEligibleAt: "2026-04-08T12:00:00.000Z",
      });
    }
  );

  it.each(routes)(
    "serializes forced $name responses consistently",
    async ({ handler, source, workerId, url }) => {
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockResolvedValue({
        outcome: "forced",
        runId: 23,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T10:30:00.000Z"),
      });

      const response = await handler(makeRequest(`${url}?force=1`));

      expect(mockEnqueueSyncRun).toHaveBeenCalledWith(source, {
        trigger: "manual",
        force: true,
      });
      expect(mockCreateWorkerId).toHaveBeenCalledWith(workerId);
      expect(mockStartBackgroundSyncDrain).toHaveBeenCalledWith(workerId, {
        source,
        runIds: [23],
        triggerLabel: "manual " + source + " sync request",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        outcome: "forced",
        runId: 23,
        reason: null,
        nextEligibleAt: "2026-04-08T10:30:00.000Z",
        drain_started: true,
      });
    }
  );

  it.each(routes)(
    "returns 500 for unexpected auth errors on $name",
    async ({ handler, name, url }) => {
      const error = new Error(`${name} auth exploded`);
      mockAuthorizeSyncRequest.mockRejectedValue(error);

      const response = await handler(makeRequest(url));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `[sync-api] unexpected ${name} route error`,
        error
      );
    }
  );

  it.each(routes)(
    "returns 500 for unexpected enqueue errors on $name",
    async ({ handler, name, url }) => {
      const error = new Error(`${name} enqueue exploded`);
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockRejectedValue(error);

      const response = await handler(makeRequest(url));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `[sync-api] unexpected ${name} route error`,
        error
      );
    }
  );

  it.each(routes)(
    "returns 500 for unexpected worker startup errors on $name",
    async ({ handler, name, source, url }) => {
      const error = new Error(`${name} worker exploded`);
      mockAuthorizeSyncRequest.mockResolvedValue("manual");
      mockEnqueueSyncRun.mockResolvedValue({
        outcome: "queued",
        runId: 17,
        reason: null,
        nextEligibleAt: new Date("2026-04-08T09:00:00.000Z"),
      });
      mockStartBackgroundSyncDrain.mockImplementation(() => {
        throw error;
      });

      const response = await handler(makeRequest(url));

      expect(mockEnqueueSyncRun).toHaveBeenCalledWith(source, {
        trigger: "manual",
        force: false,
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `[sync-api] unexpected ${name} route error`,
        error
      );
    }
  );
});
