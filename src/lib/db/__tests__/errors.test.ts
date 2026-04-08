import { describe, expect, it } from "vitest";
import {
  getSchemaCompatibilityMessage,
  isSchemaCompatibilityError,
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
