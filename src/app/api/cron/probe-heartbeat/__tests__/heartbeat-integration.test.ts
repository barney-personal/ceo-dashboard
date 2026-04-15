import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stateful in-memory repo — simulates DB for heartbeat → alerter integration
// ---------------------------------------------------------------------------

interface MockRun {
  id: number;
  probeId: string;
  checkName: string;
  status: string;
  latencyMs: number;
  detailsJson: unknown;
  ts: Date;
}

interface MockIncident {
  id: number;
  checkName: string;
  openedAt: Date;
  escalationLevel: number;
  lastAlertedAt: Date | null;
  closedAt: Date | null;
}

const { state, mockAllHeartbeats } = vi.hoisted(() => {
  const state = {
    runs: [] as MockRun[],
    incidents: [] as MockIncident[],
    nextRunId: 1,
    nextIncidentId: 1,
  };
  const mockAllHeartbeats = vi.fn();
  return { state, mockAllHeartbeats };
});

vi.mock("@/lib/probes/repo", () => ({
  allHeartbeats: mockAllHeartbeats,

  insertProbeRun: vi.fn(async (payload: Record<string, unknown>) => {
    const run: MockRun = {
      id: state.nextRunId++,
      probeId: payload.probeId as string,
      checkName: payload.checkName as string,
      status: payload.status as string,
      latencyMs: payload.latencyMs as number,
      detailsJson: payload.details ?? null,
      ts: new Date(),
    };
    state.runs.unshift(run);
    return { id: run.id, ts: run.ts };
  }),

  lastRunsForCheck: vi.fn(async (checkName: string, limit = 5) =>
    state.runs.filter((r) => r.checkName === checkName).slice(0, limit)
  ),

  openIncidentForCheck: vi.fn(async (checkName: string) =>
    state.incidents.find((i) => i.checkName === checkName && !i.closedAt) ??
    null
  ),

  openIncident: vi.fn(async (checkName: string, level: number) => {
    if (state.incidents.some((i) => i.checkName === checkName && !i.closedAt))
      return null;
    const now = new Date();
    const inc: MockIncident = {
      id: state.nextIncidentId++,
      checkName,
      openedAt: now,
      escalationLevel: level,
      lastAlertedAt: now,
      closedAt: null,
    };
    state.incidents.push(inc);
    return { id: inc.id };
  }),

  closeIncident: vi.fn(async (id: number) => {
    const inc = state.incidents.find((i) => i.id === id && !i.closedAt);
    if (!inc) return false;
    inc.closedAt = new Date();
    return true;
  }),

  escalateIncident: vi.fn(
    async (id: number, level: number, at: Date) => {
      const inc = state.incidents.find(
        (i) => i.id === id && !i.closedAt && i.escalationLevel < level
      );
      if (!inc) return false;
      inc.escalationLevel = level;
      inc.lastAlertedAt = at;
      return true;
    }
  ),

  setLastAlertedAt: vi.fn(async (id: number, at: Date) => {
    const inc = state.incidents.find((i) => i.id === id && !i.closedAt);
    if (!inc || (inc.lastAlertedAt && inc.lastAlertedAt >= at)) return false;
    inc.lastAlertedAt = at;
    return true;
  }),
}));

vi.mock("@/lib/probes/telegram", () => ({
  sendTelegram: vi.fn().mockResolvedValue({ ok: true, messageId: 1 }),
}));

// ---------------------------------------------------------------------------
// Real alerter logic runs (NOT mocked)
// ---------------------------------------------------------------------------

import { GET } from "../route";
import { sendTelegram } from "@/lib/probes/telegram";

const CRON_SECRET = "test-cron-secret";
const mockTelegram = vi.mocked(sendTelegram);

function makeRequest() {
  return new Request("http://localhost/api/cron/probe-heartbeat", {
    method: "GET",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function heartbeat(probeId: string, minutesAgo: number) {
  return {
    probeId,
    lastSeenAt: new Date(Date.now() - minutesAgo * 60_000),
    version: "v1.0",
  };
}

// ---------------------------------------------------------------------------
// Integration: heartbeat route → repo → alerter → telegram
// ---------------------------------------------------------------------------

describe("GET /api/cron/probe-heartbeat — integration (route → alerter → telegram)", () => {
  beforeEach(() => {
    state.runs = [];
    state.incidents = [];
    state.nextRunId = 1;
    state.nextIncidentId = 1;
    mockTelegram.mockClear();
    mockAllHeartbeats.mockReset();
    process.env.INTERNAL_CRON_SECRET = CRON_SECRET;
  });

  it("stale heartbeat creates incident and sends Telegram alert", async () => {
    mockAllHeartbeats.mockResolvedValue([heartbeat("ha-local", 20)]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stale).toEqual(["ha-local"]);

    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].checkName).toBe("heartbeat:ha-local");
    expect(state.runs[0].status).toBe("red");

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].checkName).toBe("heartbeat:ha-local");
    expect(state.incidents[0].closedAt).toBeNull();

    expect(mockTelegram).toHaveBeenCalledOnce();
    expect(mockTelegram.mock.calls[0][0]).toContain("🚨");
    expect(mockTelegram.mock.calls[0][0]).toContain("heartbeat:ha-local");
  });

  it("recovery: stale heartbeat creates incident, then fresh heartbeat resolves it", async () => {
    // Phase 1: stale → incident
    mockAllHeartbeats.mockResolvedValue([heartbeat("ha-local", 20)]);
    await GET(makeRequest());
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].closedAt).toBeNull();
    mockTelegram.mockClear();

    // Phase 2: fresh → recovery
    mockAllHeartbeats.mockResolvedValue([heartbeat("ha-local", 5)]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.recovered).toEqual(["ha-local"]);

    expect(state.incidents[0].closedAt).not.toBeNull();
    expect(mockTelegram).toHaveBeenCalledOnce();
    expect(mockTelegram.mock.calls[0][0]).toContain("✅");
    expect(mockTelegram.mock.calls[0][0]).toContain("recovered");
  });

  it("fresh heartbeat with no open incident does nothing", async () => {
    mockAllHeartbeats.mockResolvedValue([heartbeat("ha-local", 5)]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stale).toEqual([]);
    expect(body.recovered).toEqual([]);
    expect(state.runs).toHaveLength(0);
    expect(state.incidents).toHaveLength(0);
    expect(mockTelegram).not.toHaveBeenCalled();
  });
});
