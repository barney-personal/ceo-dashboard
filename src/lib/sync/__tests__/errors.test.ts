import { describe, expect, it } from "vitest";

import {
  SyncCancelledError,
  isSyncCancelledError,
} from "../errors";

describe("isSyncCancelledError", () => {
  it("returns true for SyncCancelledError instances", () => {
    expect(isSyncCancelledError(new SyncCancelledError())).toBe(true);
  });

  it("returns false for other error shapes", () => {
    expect(isSyncCancelledError(new Error("boom"))).toBe(false);
    expect(isSyncCancelledError({ name: "SyncCancelledError" })).toBe(false);
  });
});
