import { describe, it, expect } from "vitest";
import { hasAccess, getUserRole, type Role } from "../roles";

describe("hasAccess", () => {
  const cases: [Role, Role, boolean][] = [
    // CEO can access everything
    ["ceo", "ceo", true],
    ["ceo", "leadership", true],
    ["ceo", "manager", true],
    ["ceo", "everyone", true],
    // Leadership can access leadership and below
    ["leadership", "ceo", false],
    ["leadership", "leadership", true],
    ["leadership", "manager", true],
    ["leadership", "everyone", true],
    // Manager can access manager and below (but not leadership or CEO)
    ["manager", "ceo", false],
    ["manager", "leadership", false],
    ["manager", "manager", true],
    ["manager", "everyone", true],
    // Everyone can only access everyone
    ["everyone", "ceo", false],
    ["everyone", "leadership", false],
    ["everyone", "manager", false],
    ["everyone", "everyone", true],
  ];

  it.each(cases)(
    "%s accessing %s-level content → %s",
    (userRole, requiredRole, expected) => {
      expect(hasAccess(userRole, requiredRole)).toBe(expected);
    }
  );
});

describe("getUserRole", () => {
  it("returns 'ceo' when role is set to ceo", () => {
    expect(getUserRole({ role: "ceo" })).toBe("ceo");
  });

  it("returns 'leadership' when role is set to leadership", () => {
    expect(getUserRole({ role: "leadership" })).toBe("leadership");
  });

  it("defaults to 'everyone' when no role is set", () => {
    expect(getUserRole({})).toBe("everyone");
  });

  it("defaults to 'everyone' for empty metadata", () => {
    expect(getUserRole({})).toBe("everyone");
  });

  it("defaults to 'everyone' for invalid role values", () => {
    expect(getUserRole({ role: "admin" })).toBe("everyone");
    expect(getUserRole({ role: "" })).toBe("everyone");
    expect(getUserRole({ role: 123 })).toBe("everyone");
    expect(getUserRole({ role: null })).toBe("everyone");
  });

  it("ignores other metadata fields", () => {
    expect(getUserRole({ role: "ceo", name: "Test" })).toBe("ceo");
  });
});
