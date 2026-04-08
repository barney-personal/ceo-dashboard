import { describe, expect, it } from "vitest";
import {
  DatabaseUnavailableError,
  getSchemaCompatibilityMessage,
  isDatabaseUnavailableError,
  isSchemaCompatibilityError,
  normalizeDatabaseError,
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
