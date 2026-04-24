import { NextRequest, NextResponse } from "next/server";
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
  listRankingSnapshotSlices,
  persistRankingSnapshot,
  readRankingSnapshot,
} from "@/lib/data/engineering-ranking.server";
import { GET, POST } from "../route";

const mockRequireRole = vi.mocked(requireRole);
const mockAuthErrorResponse = vi.mocked(authErrorResponse);
const mockLoadWithSignals = vi.mocked(getEngineeringRankingSnapshotWithSignals);
const mockListSlices = vi.mocked(listRankingSnapshotSlices);
const mockPersist = vi.mocked(persistRankingSnapshot);
const mockReadSnapshot = vi.mocked(readRankingSnapshot);

function makeRequest() {
  return new NextRequest("http://localhost/api/engineering-ranking/snapshot", {
    method: "POST",
  });
}

function makeGetRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/engineering-ranking/snapshot${query}`,
    {
      method: "GET",
    },
  );
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

describe("GET /api/engineering-ranking/snapshot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthErrorResponse.mockImplementation((auth) => {
      if (auth.ok) return null;
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    });
    mockRequireRole.mockResolvedValue({ ok: true });
  });

  it("lists snapshot slices when no `date` query parameter is supplied", async () => {
    mockListSlices.mockResolvedValue([
      {
        snapshotDate: "2026-04-24",
        methodologyVersion: "1.1.0-quality",
        rowCount: 12,
      },
    ] as Awaited<ReturnType<typeof listRankingSnapshotSlices>>);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    expect(mockListSlices).toHaveBeenCalledTimes(1);
    expect(mockReadSnapshot).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      slices: [
        {
          snapshotDate: "2026-04-24",
          methodologyVersion: "1.1.0-quality",
          rowCount: 12,
        },
      ],
    });
  });

  it("reads a specific snapshot slice when date and version are supplied", async () => {
    mockReadSnapshot.mockResolvedValue([
      {
        snapshotDate: "2026-04-24",
        methodologyVersion: "1.1.0-quality",
        emailHash: "ffeeddccbbaa9988",
      },
    ] as Awaited<ReturnType<typeof readRankingSnapshot>>);

    const res = await GET(
      makeGetRequest("?date=2026-04-24&version=1.1.0-quality"),
    );

    expect(res.status).toBe(200);
    expect(mockListSlices).not.toHaveBeenCalled();
    expect(mockReadSnapshot).toHaveBeenCalledTimes(1);
    expect(mockReadSnapshot).toHaveBeenCalledWith({
      snapshotDate: "2026-04-24",
      methodologyVersion: "1.1.0-quality",
    });
    const body = await res.json();
    expect(body.snapshotDate).toBe("2026-04-24");
    expect(body.methodologyVersion).toBe("1.1.0-quality");
  });

  it("defaults methodologyVersion to the current constant when `version` is absent", async () => {
    mockReadSnapshot.mockResolvedValue([]);
    await GET(makeGetRequest("?date=2026-04-24"));
    const args = mockReadSnapshot.mock.calls[0][0];
    expect(args.snapshotDate).toBe("2026-04-24");
    expect(args.methodologyVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects malformed `date` values with 400 instead of silently returning empty 200", async () => {
    const res = await GET(makeGetRequest("?date=yesterday"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/YYYY-MM-DD/);
    expect(body.received).toBe("yesterday");
    expect(mockReadSnapshot).not.toHaveBeenCalled();
    expect(mockListSlices).not.toHaveBeenCalled();
  });

  it("rejects SQL-fragment-looking `date` values with 400 (defence in depth)", async () => {
    // The read path uses parameterised queries, so this is purely
    // about refusing nonsense input rather than injection.
    const res = await GET(
      makeGetRequest("?date=2026-04-24%27%20OR%20%271%27%3D%271"),
    );
    expect(res.status).toBe(400);
    expect(mockReadSnapshot).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
    const res = await GET(makeGetRequest("?date=2026-04-24"));
    expect(res.status).toBe(401);
    expect(mockReadSnapshot).not.toHaveBeenCalled();
    expect(mockListSlices).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks CEO role", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(403);
    expect(mockListSlices).not.toHaveBeenCalled();
    expect(mockReadSnapshot).not.toHaveBeenCalled();
  });
});
