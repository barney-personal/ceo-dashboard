import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be before route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/probes/repo", () => ({
  allHeartbeats: vi.fn(),
  insertProbeRun: vi.fn(),
  openIncidentForCheck: vi.fn(),
}));

vi.mock("@/lib/probes/alerter", () => ({
  runAlerter: vi.fn(),
}));

import { GET } from "../route";
import {
  allHeartbeats,
  insertProbeRun,
  openIncidentForCheck,
} from "@/lib/probes/repo";
import { runAlerter } from "@/lib/probes/alerter";

const mockAllHeartbeats = allHeartbeats as ReturnType<typeof vi.fn>;
const mockInsertProbeRun = insertProbeRun as ReturnType<typeof vi.fn>;
const mockOpenIncidentForCheck = openIncidentForCheck as ReturnType<typeof vi.fn>;
const mockRunAlerter = runAlerter as ReturnType<typeof vi.fn>;

function makeRequest(secret?: string) {
  const headers = new Headers();
  if (secret) {
    headers.set("authorization", `Bearer ${secret}`);
  }
  return new Request("http://localhost/api/cron/probe-heartbeat", {
    method: "GET",
    headers,
  });
}

function freshHeartbeat(probeId: string, minutesAgo: number) {
  return {
    probeId,
    lastSeenAt: new Date(Date.now() - minutesAgo * 60_000),
    version: "abc123",
  };
}

describe("GET /api/cron/probe-heartbeat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INTERNAL_CRON_SECRET = "test-cron-secret";
    mockAllHeartbeats.mockResolvedValue([]);
    mockInsertProbeRun.mockResolvedValue({ id: 1, ts: new Date() });
    mockOpenIncidentForCheck.mockResolvedValue(null);
    mockRunAlerter.mockResolvedValue(undefined);
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it("returns 401 when no authorization header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when secret is wrong", async () => {
    const res = await GET(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when INTERNAL_CRON_SECRET is not configured", async () => {
    delete process.env.INTERNAL_CRON_SECRET;
    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  it("returns 200 with empty results when no heartbeats exist", async () => {
    mockAllHeartbeats.mockResolvedValue([]);
    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stale).toEqual([]);
    expect(body.recovered).toEqual([]);
    expect(mockInsertProbeRun).not.toHaveBeenCalled();
    expect(mockRunAlerter).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Stale heartbeats → synthetic red probe runs
  // -----------------------------------------------------------------------

  it("inserts red probe run for stale heartbeat and runs alerter", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 20), // 20 min ago = stale
    ]);

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);

    // Deterministic synthetic check name
    expect(mockInsertProbeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        probeId: "ha-local",
        checkName: "heartbeat:ha-local",
        status: "red",
        latencyMs: 0,
      })
    );

    expect(mockRunAlerter).toHaveBeenCalledWith("heartbeat:ha-local");

    const body = await res.json();
    expect(body.stale).toEqual(["ha-local"]);
  });

  it("processes multiple stale heartbeats independently", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 20),
      freshHeartbeat("cloud-cron", 30),
    ]);

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);

    expect(mockInsertProbeRun).toHaveBeenCalledTimes(2);
    expect(mockRunAlerter).toHaveBeenCalledTimes(2);
    expect(mockRunAlerter).toHaveBeenCalledWith("heartbeat:ha-local");
    expect(mockRunAlerter).toHaveBeenCalledWith("heartbeat:cloud-cron");
  });

  it("includes stale duration in details", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 25),
    ]);

    await GET(makeRequest("test-cron-secret"));

    expect(mockInsertProbeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          reason: expect.stringContaining("no heartbeat"),
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // Recovery — fresh heartbeats with open incidents
  // -----------------------------------------------------------------------

  it("inserts green recovery run when fresh heartbeat has open incident", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 5), // 5 min ago = fresh
    ]);
    mockOpenIncidentForCheck.mockResolvedValue({
      id: 42,
      checkName: "heartbeat:ha-local",
      openedAt: new Date(),
      escalationLevel: 0,
      lastAlertedAt: new Date(),
    });

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);

    expect(mockInsertProbeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        probeId: "ha-local",
        checkName: "heartbeat:ha-local",
        status: "green",
        latencyMs: 0,
      })
    );
    expect(mockRunAlerter).toHaveBeenCalledWith("heartbeat:ha-local");

    const body = await res.json();
    expect(body.recovered).toEqual(["ha-local"]);
  });

  it("does not insert recovery run for fresh heartbeat without open incident", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 5),
    ]);
    mockOpenIncidentForCheck.mockResolvedValue(null);

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);

    expect(mockInsertProbeRun).not.toHaveBeenCalled();
    expect(mockRunAlerter).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Mixed state — stale + fresh with incident
  // -----------------------------------------------------------------------

  it("handles mixed stale and recovering heartbeats", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 20),      // stale
      freshHeartbeat("cloud-cron", 3),     // fresh
    ]);
    // cloud-cron had an open incident (was stale before, now recovered)
    mockOpenIncidentForCheck.mockImplementation(async (checkName: string) => {
      if (checkName === "heartbeat:cloud-cron") {
        return {
          id: 10,
          checkName: "heartbeat:cloud-cron",
          openedAt: new Date(),
          escalationLevel: 0,
          lastAlertedAt: new Date(),
        };
      }
      return null;
    });

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);

    // ha-local: red synthetic run
    expect(mockInsertProbeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        probeId: "ha-local",
        checkName: "heartbeat:ha-local",
        status: "red",
      })
    );
    // cloud-cron: green recovery run
    expect(mockInsertProbeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        probeId: "cloud-cron",
        checkName: "heartbeat:cloud-cron",
        status: "green",
      })
    );

    expect(mockRunAlerter).toHaveBeenCalledTimes(2);

    const body = await res.json();
    expect(body.stale).toEqual(["ha-local"]);
    expect(body.recovered).toEqual(["cloud-cron"]);
  });

  // -----------------------------------------------------------------------
  // Alerter errors don't crash the route
  // -----------------------------------------------------------------------

  it("continues processing when alerter throws for one heartbeat", async () => {
    mockAllHeartbeats.mockResolvedValue([
      freshHeartbeat("ha-local", 20),
      freshHeartbeat("cloud-cron", 25),
    ]);
    mockRunAlerter
      .mockRejectedValueOnce(new Error("telegram down"))
      .mockResolvedValueOnce(undefined);

    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(200);

    // Both were processed despite first alerter failing
    expect(mockInsertProbeRun).toHaveBeenCalledTimes(2);
    expect(mockRunAlerter).toHaveBeenCalledTimes(2);
  });
});
