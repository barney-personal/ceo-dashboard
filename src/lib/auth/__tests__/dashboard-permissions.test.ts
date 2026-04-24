import { describe, expect, it } from "vitest";
import {
  buildDashboardNavGroups,
  buildDashboardPermissionSummaries,
} from "../dashboard-permissions";

describe("buildDashboardPermissionSummaries", () => {
  it("uses code defaults when no overrides are stored", () => {
    const summaries = buildDashboardPermissionSummaries();
    const financial = summaries.find(
      (summary) => summary.id === "dashboard.financial",
    );
    const permissions = summaries.find(
      (summary) => summary.id === "admin.permissions",
    );

    expect(financial?.requiredRole).toBe("leadership");
    expect(financial?.isOverride).toBe(false);
    expect(permissions?.defaultRole).toBe("ceo");
    expect(permissions?.requiredRole).toBe("ceo");
    expect(permissions?.isNavItem).toBe(true);
    expect(permissions?.editable).toBe(false);
  });

  it("marks rows as overrides when an override is present", () => {
    const summaries = buildDashboardPermissionSummaries({
      "dashboard.financial": "manager",
    });
    const financial = summaries.find(
      (summary) => summary.id === "dashboard.financial",
    );

    expect(financial?.requiredRole).toBe("manager");
    expect(financial?.isOverride).toBe(true);
  });

  it("ignores stored overrides for locked permissions", () => {
    const summaries = buildDashboardPermissionSummaries({
      "admin.users": "everyone",
      "admin.status": "everyone",
      "engineering.codeReview": "everyone",
    });

    expect(
      summaries.find((summary) => summary.id === "admin.users"),
    ).toMatchObject({
      requiredRole: "ceo",
      editable: false,
      isOverride: false,
    });
    expect(
      summaries.find((summary) => summary.id === "admin.status"),
    ).toMatchObject({
      requiredRole: "ceo",
      editable: false,
      isOverride: false,
    });
    expect(
      summaries.find((summary) => summary.id === "engineering.codeReview"),
    ).toMatchObject({
      requiredRole: "ceo",
      editable: false,
      isOverride: false,
    });
  });
});

describe("buildDashboardNavGroups", () => {
  it("includes the permissions page in the Admin group", () => {
    const navGroups = buildDashboardNavGroups();
    const adminGroup = navGroups.find((group) => group.label === "Admin");

    expect(adminGroup?.items.map((item) => item.href)).toContain(
      "/dashboard/admin/permissions",
    );
  });

  it("marks parent routes as exact-match when sibling child routes exist", () => {
    const navGroups = buildDashboardNavGroups();
    const teamGroup = navGroups.find((group) => group.label === "Team");
    const peopleItem = teamGroup?.items.find(
      (item) => item.href === "/dashboard/people",
    );

    expect(peopleItem?.exactMatch).toBe(true);
  });

  it("does not lower locked nav items from stored overrides", () => {
    const navGroups = buildDashboardNavGroups({
      "admin.status": "everyone",
    });
    const adminGroup = navGroups.find((group) => group.label === "Admin");
    const statusItem = adminGroup?.items.find(
      (item) => item.permissionId === "admin.status",
    );

    expect(statusItem?.requiredRole).toBe("ceo");
  });
});
