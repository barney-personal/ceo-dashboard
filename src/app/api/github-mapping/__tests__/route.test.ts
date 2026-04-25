import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/dashboard-permissions.api", () => ({
  dashboardPermissionErrorResponse: vi.fn(),
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

import { dashboardPermissionErrorResponse } from "@/lib/auth/dashboard-permissions.api";
import { db } from "@/lib/db";
import { PUT } from "../route";

const mockPermissionGate = vi.mocked(dashboardPermissionErrorResponse);
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
    mockPermissionGate.mockResolvedValue(null);
  });

  it("returns 403 when permission gate denies", async () => {
    mockPermissionGate.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );
    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: "a@b.com" })
    );
    expect(res.status).toBe(403);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when login is missing", async () => {
    const res = await PUT(makeRequest({ employeeEmail: "a@b.com" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "login is required" });
  });

  it("returns 400 when login is blank", async () => {
    const res = await PUT(
      makeRequest({ login: "  ", employeeEmail: "a@b.com" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when employeeEmail key is missing", async () => {
    const res = await PUT(makeRequest({ login: "alice" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "employeeEmail is required (pass null to clear)",
    });
  });

  it("returns 400 when employeeEmail is a number", async () => {
    const res = await PUT(
      makeRequest({ login: "alice", employeeEmail: 42 })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "employeeEmail must be a string or null",
    });
  });

  it("upserts mapping with manual high confidence when assigning an employee", async () => {
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
