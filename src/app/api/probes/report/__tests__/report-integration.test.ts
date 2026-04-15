// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stateful in-memory repo — simulates DB for multi-step integration scenarios
// ---------------------------------------------------------------------------

interface MockRun {
  id: number;
  probeId: string;
  checkName: string;
  status: string;
  latencyMs: number;
  detailsJson: unknown;
  runId: string | null;
  target: string;
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

const { state } = vi.hoisted(() => {
  const state = {
    runs: [] as MockRun[],
    incidents: [] as MockIncident[],
    nextRunId: 1,
    nextIncidentId: 1,
  };
  return { state };
});

vi.mock("@/lib/probes/repo", () => ({
  insertProbeRun: vi.fn(async (payload: Record<string, unknown>) => {
    const run: MockRun = {
      id: state.nextRunId++,
      probeId: payload.probeId as string,
      checkName: payload.checkName as string,
      status: payload.status as string,
      latencyMs: payload.latencyMs as number,
      detailsJson: payload.details ?? null,
      runId: (payload.runId as string) ?? null,
      target: (payload.target as string) ?? "prod",
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
// Real modules (NOT mocked) — HMAC signing + alerter logic run for real
// ---------------------------------------------------------------------------

import { POST } from "../route";
import { signPayload } from "@/lib/probes/hmac";
import { sendTelegram } from "@/lib/probes/telegram";

const SECRET = "integration-test-secret";
const mockTelegram = vi.mocked(sendTelegram);

function makeSignedRequest(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const { signature, ts } = signPayload(raw, SECRET);
  return new Request("http://localhost/api/probes/report", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Probe-Signature": signature,
      "X-Probe-Timestamp": String(ts),
    },
  });
}

async function flushAlerter() {
  await new Promise((r) => setTimeout(r, 0));
}

const RED_PAYLOAD = {
  probeId: "ceo-15m",
  checkName: "ceo-ping-auth",
  status: "red",
  latencyMs: 500,
  details: { reason: "db_ok false" },
};

const GREEN_PAYLOAD = {
  probeId: "ceo-15m",
  checkName: "ceo-ping-auth",
  status: "green",
  latencyMs: 100,
  details: { version: "abc123" },
};

// ---------------------------------------------------------------------------
// Integration: route → HMAC verify → insertProbeRun → alerter → telegram
// ---------------------------------------------------------------------------

describe("POST /api/probes/report — integration (route → alerter → telegram)", () => {
  beforeEach(() => {
    state.runs = [];
    state.incidents = [];
    state.nextRunId = 1;
    state.nextIncidentId = 1;
    mockTelegram.mockClear();
    vi.stubEnv("PROBE_SECRET", SECRET);
  });

  it("opens incident on first red and sends Telegram alert", async () => {
    const res = await POST(makeSignedRequest(RED_PAYLOAD));
    expect(res.status).toBe(201);
    await flushAlerter();

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].checkName).toBe("ceo-ping-auth");
    expect(state.incidents[0].closedAt).toBeNull();
    expect(mockTelegram).toHaveBeenCalledOnce();
    expect(mockTelegram.mock.calls[0][0]).toContain("🚨");
    expect(mockTelegram.mock.calls[0][0]).toContain("ceo-ping-auth");
  });

  it("escalates after 3 consecutive red reports", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(makeSignedRequest(RED_PAYLOAD));
      expect(res.status).toBe(201);
      await flushAlerter();
    }

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].escalationLevel).toBe(1);
    expect(mockTelegram).toHaveBeenCalledTimes(2);
    expect(mockTelegram.mock.calls[0][0]).toContain("🚨");
    expect(mockTelegram.mock.calls[1][0]).toContain("⚠️");
    expect(mockTelegram.mock.calls[1][0]).toContain("still failing");
  });

  it("recovers incident on green report after failure", async () => {
    await POST(makeSignedRequest(RED_PAYLOAD));
    await flushAlerter();
    expect(state.incidents[0].closedAt).toBeNull();
    mockTelegram.mockClear();

    const res = await POST(makeSignedRequest(GREEN_PAYLOAD));
    expect(res.status).toBe(201);
    await flushAlerter();

    expect(state.incidents[0].closedAt).not.toBeNull();
    expect(mockTelegram).toHaveBeenCalledOnce();
    expect(mockTelegram.mock.calls[0][0]).toContain("✅");
    expect(mockTelegram.mock.calls[0][0]).toContain("recovered");
  });

  it("green with no prior incident sends no Telegram", async () => {
    const res = await POST(makeSignedRequest(GREEN_PAYLOAD));
    expect(res.status).toBe(201);
    await flushAlerter();

    expect(state.incidents).toHaveLength(0);
    expect(mockTelegram).not.toHaveBeenCalled();
  });

  it("full lifecycle: open → escalate → recover in sequence", async () => {
    for (let i = 0; i < 3; i++) {
      await POST(makeSignedRequest(RED_PAYLOAD));
      await flushAlerter();
    }
    expect(state.incidents[0].escalationLevel).toBe(1);
    expect(state.incidents[0].closedAt).toBeNull();
    mockTelegram.mockClear();

    await POST(makeSignedRequest(GREEN_PAYLOAD));
    await flushAlerter();

    expect(state.incidents[0].closedAt).not.toBeNull();
    expect(mockTelegram).toHaveBeenCalledOnce();
    expect(mockTelegram.mock.calls[0][0]).toContain("✅");
  });
});
