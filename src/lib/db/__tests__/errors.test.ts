import { describe, expect, it } from "vitest";
import {
  DatabaseUnavailableError,
  getSchemaCompatibilityMessage,
  isDatabaseUnavailableError,
  isSchemaCompatibilityError,
  isUniqueViolation,
  normalizeDatabaseError,
  withDbErrorContext,
} from "../errors";

describe("isSchemaCompatibilityError", () => {
  it("detects postgres missing-column errors by code", () => {
    expect(
      isSchemaCompatibilityError({
        code: "42703",
        message: 'column "heartbeat_at" does not exist',
      })
    ).toBe(true);
  });

  it("detects schema rollout errors by message", () => {
    expect(
      isSchemaCompatibilityError(
        new Error('relation "sync_phases" does not exist')
      )
    ).toBe(true);
  });

  it("ignores unrelated runtime errors", () => {
    expect(
      isSchemaCompatibilityError(new Error("Connection pool exhausted"))
    ).toBe(false);
  });
});

describe("getSchemaCompatibilityMessage", () => {
  it("includes the original error text when available", () => {
    expect(
      getSchemaCompatibilityMessage(
        new Error('column "trigger" does not exist')
      )
    ).toContain('column "trigger" does not exist');
  });
});

describe("isUniqueViolation", () => {
  it("detects postgres unique_violation by code", () => {
    expect(
      isUniqueViolation({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "sync_log_active_per_source"',
      })
    ).toBe(true);
  });

  it("returns false for unrelated postgres error codes", () => {
    expect(isUniqueViolation({ code: "42703", message: "boom" })).toBe(false);
    expect(isUniqueViolation({ code: "23503", message: "fk" })).toBe(false);
  });

  it("returns false for non-string code values", () => {
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });

  it("returns false for plain Error without a code", () => {
    expect(isUniqueViolation(new Error("duplicate key"))).toBe(false);
  });

  it("returns false for null and primitives", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(23505)).toBe(false);
  });
});

describe("isDatabaseUnavailableError", () => {
  it("detects postgres connection timeout errors by code", () => {
    expect(
      isDatabaseUnavailableError({
        code: "CONNECT_TIMEOUT",
        message: "connect timeout",
      })
    ).toBe(true);
  });

  it("detects statement timeouts by message", () => {
    expect(
      isDatabaseUnavailableError(
        new Error("canceling statement due to statement timeout")
      )
    ).toBe(true);
  });
});

describe("normalizeDatabaseError", () => {
  it("wraps transient Postgres failures in DatabaseUnavailableError", () => {
    const error = normalizeDatabaseError(
      "Load dashboard metrics",
      new Error("fetch failed")
    );

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error.message).toContain("Load dashboard metrics");
  });

  it("rewrites schema rollout failures with the compatibility message", () => {
    const error = normalizeDatabaseError(
      "Load dashboard metrics",
      new Error('relation "sync_log" does not exist')
    );

    expect(error).not.toBeInstanceOf(DatabaseUnavailableError);
    expect(error.message).toContain("Render migration");
  });
});

describe("withDbErrorContext", () => {
  it("returns the resolved value when the loader succeeds", async () => {
    await expect(
      withDbErrorContext("load foo", async () => 42)
    ).resolves.toBe(42);
  });

  it("wraps transient Postgres failures in DatabaseUnavailableError", async () => {
    await expect(
      withDbErrorContext("load widgets", async () => {
        throw new Error("fetch failed");
      })
    ).rejects.toMatchObject({
      name: "DatabaseUnavailableError",
    });
  });

  it("rewrites schema rollout failures with the compatibility message", async () => {
    await expect(
      withDbErrorContext("load widgets", async () => {
        throw new Error('column "foo" does not exist');
      })
    ).rejects.toThrow(/Render migration/);
  });

  it("passes DatabaseUnavailableError through without re-wrapping", async () => {
    const original = new DatabaseUnavailableError(
      "inner loader could not reach Postgres"
    );
    await expect(
      withDbErrorContext("outer loader", async () => {
        throw original;
      })
    ).rejects.toBe(original);
  });

  it("passes non-DB errors through unchanged", async () => {
    const domainError = new Error("application logic failed");
    await expect(
      withDbErrorContext("load widgets", async () => {
        throw domainError;
      })
    ).rejects.toBe(domainError);
  });
});
