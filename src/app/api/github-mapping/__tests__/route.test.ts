import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sync/request-auth", () => ({
  authErrorResponse: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { authErrorResponse, requireRole } from "@/lib/sync/request-auth";
import { db } from "@/lib/db";
import { PUT } from "../route";

const mockAuthErrorResponse = vi.mocked(authErrorResponse);
const mockRequireRole = vi.mocked(requireRole);
const mockDbInsert = vi.mocked(db.insert);

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/github-mapping", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as import("next/server").NextRequest;
}

function mockInsertReturning(returned: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returned);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  mockDbInsert.mockReturnValue({ values } as unknown as ReturnType<
    typeof db.insert
  >);
  return { values, onConflictDoUpdate, returning };
}

describe("PUT /api/github-mapping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuthErrorResponse.mockImplementation((auth) => {
      if (auth.ok) return null;
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: "a@b.com" })
    );
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks CEO role", async () => {
    mockRequireRole.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: "a@b.com" })
    );
    expect(res.status).toBe(403);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when login is missing", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await PUT(makeRequest({ employeeEmail: "a@b.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "login is required" });
  });

  it("returns 400 when login is blank", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await PUT(
      makeRequest({ login: "  ", employeeEmail: "a@b.com" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when employeeEmail key is missing", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await PUT(makeRequest({ login: "alice" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "employeeEmail is required (pass null to clear)",
    });
  });

  it("returns 400 when employeeEmail is a number", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: 42 })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "employeeEmail must be a string or null",
    });
  });

  it("upserts mapping with manual high confidence when assigning an employee", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const { values, onConflictDoUpdate } = mockInsertReturning([
      {
        id: 1,
        githubLogin: "alice",
        employeeName: "Alice Smith",
        employeeEmail: "alice@meetcleo.com",
        matchMethod: "manual",
        matchConfidence: "high",
        isBot: false,
        updatedAt: new Date("2026-04-16T00:00:00Z"),
      },
    ]);

    const res = await PUT(
      makeRequest({
        login: "alice",
        employeeEmail: "Alice@meetcleo.com",
        employeeName: "Alice Smith",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubLogin).toBe("alice");
    expect(body.employeeEmail).toBe("alice@meetcleo.com");

    const writtenValues = values.mock.calls[0][0];
    expect(writtenValues.githubLogin).toBe("alice");
    expect(writtenValues.employeeEmail).toBe("alice@meetcleo.com"); // lowercased
    expect(writtenValues.employeeName).toBe("Alice Smith");
    expect(writtenValues.matchMethod).toBe("manual");
    expect(writtenValues.matchConfidence).toBe("high");

    const updateSet = onConflictDoUpdate.mock.calls[0][0].set;
    expect(updateSet.employeeEmail).toBe("alice@meetcleo.com");
    expect(updateSet.matchMethod).toBe("manual");
    expect(updateSet.matchConfidence).toBe("high");
  });

  it("clears mapping when employeeEmail is null", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const { values } = mockInsertReturning([
      {
        id: 1,
        githubLogin: "alice",
        employeeName: null,
        employeeEmail: null,
        matchMethod: "manual",
        matchConfidence: null,
        isBot: false,
        updatedAt: new Date(),
      },
    ]);

    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: null, employeeName: null })
    );

    expect(res.status).toBe(200);
    const written = values.mock.calls[0][0];
    expect(written.employeeEmail).toBeNull();
    expect(written.employeeName).toBeNull();
    expect(written.matchConfidence).toBeNull();
    expect(written.matchMethod).toBe("manual");
  });

  it("treats empty string employeeEmail as clearing the mapping", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    const { values } = mockInsertReturning([
      {
        id: 1,
        githubLogin: "alice",
        employeeName: null,
        employeeEmail: null,
        matchMethod: "manual",
        matchConfidence: null,
        isBot: false,
        updatedAt: new Date(),
      },
    ]);

    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: "" })
    );

    expect(res.status).toBe(200);
    const written = values.mock.calls[0][0];
    expect(written.employeeEmail).toBeNull();
  });

  it("returns 500 when DB insert throws", async () => {
    mockRequireRole.mockResolvedValue({ ok: true });
    mockDbInsert.mockImplementation(() => {
      throw new Error("db down");
    });

    const res = await PUT(
      makeRequest({
        login: "alice",
        employeeEmail: "alice@meetcleo.com",
        employeeName: "Alice",
      })
    );
    expect(res.status).toBe(500);
  });
});
