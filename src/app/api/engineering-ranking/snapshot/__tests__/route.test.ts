import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringRankingSnapshot, PerEngineerSignalRow } from "@/lib/data/engineering-ranking";

vi.mock("@/lib/sync/request-auth", () => ({
  authErrorResponse: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/data/engineering-ranking.server", () => ({
  getEngineeringRankingSnapshotWithSignals: vi.fn(),
  getEngineeringRankingSnapshot: vi.fn(),
  listRankingSnapshotSlices: vi.fn(),
  persistRankingSnapshot: vi.fn(),
  readRankingSnapshot: vi.fn(),
}));

import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import {
  getEngineeringRankingSnapshotWithSignals,
  persistRankingSnapshot,
} from "@/lib/data/engineering-ranking.server";
import { POST } from "../route";

const mockRequireRole = vi.mocked(requireRole);
const mockAuthErrorResponse = vi.mocked(authErrorResponse);
const mockLoadWithSignals = vi.mocked(getEngineeringRankingSnapshotWithSignals);
const mockPersist = vi.mocked(persistRankingSnapshot);

function makeRequest() {
  return new Request("http://localhost/api/engineering-ranking/snapshot", {
    method: "POST",
  }) as unknown as import("next/server").NextRequest;
}

function fakeSnapshot(): EngineeringRankingSnapshot {
  return {
    methodologyVersion: "0.8.0-snapshots-test",
  } as unknown as EngineeringRankingSnapshot;
}

function fakeSignals(): PerEngineerSignalRow[] {
  return [
    {
      emailHash: "ffeeddccbbaa9988",
      prCount: 12,
      commitCount: 40,
      additions: 500,
      deletions: 50,
      shapPredicted: 10,
      shapActual: 12,
      shapResidual: 2,
      aiTokens: null,
      aiSpend: null,
      squadCycleTimeHours: 24,
      squadReviewRatePercent: 80,
      squadTimeToFirstReviewHours: 3,
      squadPrsInProgress: 4,
    },
  ];
}

describe("POST /api/engineering-ranking/snapshot (M17 signal passthrough)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthErrorResponse.mockImplementation((auth) => {
      if (auth.ok) return null;
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    });
  });

  it("passes the exact signal rows the snapshot was built from through to persistRankingSnapshot", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const snapshot = fakeSnapshot();
    const signals = fakeSignals();
    mockLoadWithSignals.mockResolvedValue({ snapshot, signals });
    mockPersist.mockResolvedValue({ rowsWritten: 1, snapshotDate: "2026-04-24" });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Must have called the `WithSignals` loader so both halves are in hand.
    expect(mockLoadWithSignals).toHaveBeenCalledTimes(1);

    // Must have persisted the snapshot AND the signals together. The prior
    // bug was a single-arg call, which silently nulled every row's
    // `input_hash` in production.
    expect(mockPersist).toHaveBeenCalledTimes(1);
    const persistArgs = mockPersist.mock.calls[0];
    expect(persistArgs[0]).toBe(snapshot);
    expect(persistArgs[1]).toBeDefined();
    expect(persistArgs[1]?.signals).toBe(signals);
  });

  it("returns 401 when unauthenticated and does not persist anything", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockLoadWithSignals).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks CEO role", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockPersist).not.toHaveBeenCalled();
  });
});
