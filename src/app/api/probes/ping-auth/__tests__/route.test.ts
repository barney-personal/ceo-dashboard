import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const executeMock = vi.fn();
  return {
    db: {
      execute: executeMock,
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(),
            })),
          })),
        })),
      })),
    },
  };
});

import { db } from "@/lib/db";
import { GET } from "../route";

const mockExecute = vi.mocked(db.execute);

function mockModeSyncQuery(completedAt: Date | null) {
  const mockLimit = vi.fn().mockResolvedValue(
    completedAt ? [{ completedAt }] : []
  );
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  (db as unknown as { select: typeof mockSelect }).select = mockSelect;
}

describe("GET /api/probes/ping-auth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("RENDER_GIT_COMMIT", "abc123def");
    mockExecute.mockResolvedValue([] as unknown as never);
    mockModeSyncQuery(new Date(Date.now() - 3 * 60 * 60 * 1000));
  });

  it("returns 200 with expected shape when healthy", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(
      expect.objectContaining({
        db_ok: true,
        version: "abc123def",
        deploying: false,
        ts: expect.any(String),
      })
    );
    expect(typeof json.mode_sync_age_hours).toBe("number");
  });

  it("returns db_ok: false when DB health check throws", async () => {
    mockExecute.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.db_ok).toBe(false);
    expect(json.version).toBe("abc123def");
    expect(json.mode_sync_age_hours).toBeNull();
  });

  it("returns mode_sync_age_hours: null when no successful Mode sync exists", async () => {
    mockModeSyncQuery(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.db_ok).toBe(true);
    expect(json.mode_sync_age_hours).toBeNull();
  });

  it("computes mode_sync_age_hours from latest successful Mode sync", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockModeSyncQuery(twoHoursAgo);
    const res = await GET();
    const json = await res.json();
    expect(json.mode_sync_age_hours).toBeGreaterThanOrEqual(1.9);
    expect(json.mode_sync_age_hours).toBeLessThanOrEqual(2.1);
  });

  it("returns version from RENDER_GIT_COMMIT env var", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "deploy-xyz");
    const res = await GET();
    const json = await res.json();
    expect(json.version).toBe("deploy-xyz");
  });

  it("returns version as null when RENDER_GIT_COMMIT is unset", async () => {
    vi.stubEnv("RENDER_GIT_COMMIT", "");
    const res = await GET();
    const json = await res.json();
    expect(json.version).toBeNull();
  });

  it("returns deploying: false by default", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.deploying).toBe(false);
  });

  it("returns ts as ISO string", async () => {
    const res = await GET();
    const json = await res.json();
    const parsed = new Date(json.ts);
    expect(parsed.toISOString()).toBe(json.ts);
  });
});
