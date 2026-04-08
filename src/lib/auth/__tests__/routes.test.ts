import { describe, it, expect } from "vitest";
import { isPublicPath } from "../routes";

describe("isPublicPath", () => {
  describe("public routes", () => {
    it.each([
      ["/"],
      ["/sign-in"],
      ["/sign-in/factor-one"],
      ["/sign-in/sso-callback"],
      ["/sign-up"],
      ["/sign-up/verify"],
      ["/access-denied"],
    ])("%s is public", (path) => {
      expect(isPublicPath(path)).toBe(true);
    });
  });

  describe("protected routes", () => {
    it.each([
      ["/dashboard"],
      ["/dashboard/unit-economics"],
      ["/dashboard/financial"],
      ["/dashboard/product"],
      ["/dashboard/okrs"],
      ["/dashboard/people"],
      ["/api/upload"],
      ["/api/sync/mode"],
      ["/api/cron"],
      ["/api/webhooks/clerk"],
    ])("%s is protected", (path) => {
      expect(isPublicPath(path)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("sign-in with nested paths is public", () => {
      expect(isPublicPath("/sign-in/some/deep/path")).toBe(true);
    });

    it("/sign-inxyz is not public (must be exact or have slash)", () => {
      expect(isPublicPath("/sign-inxyz")).toBe(false);
    });

    it("/dashboard-like paths are protected", () => {
      expect(isPublicPath("/dashboard/anything")).toBe(false);
    });
  });
});
