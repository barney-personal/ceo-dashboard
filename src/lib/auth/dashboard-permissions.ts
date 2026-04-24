import type { Role } from "./roles";

export type NavIconKey =
  | "activity"
  | "alert-triangle"
  | "bar-chart-3"
  | "calculator"
  | "calendar"
  | "clipboard-list"
  | "compass"
  | "database"
  | "git-pull-request"
  | "heart"
  | "heart-pulse"
  | "layout-dashboard"
  | "message-square"
  | "pound-sterling"
  | "settings"
  | "shield"
  | "sparkles"
  | "target"
  | "trending-up"
  | "user-plus"
  | "users";

export interface DashboardPermissionDefinition {
  id: string;
  label: string;
  description: string;
  href: string;
  groupLabel: string;
  defaultRole: Role;
  redirectTo?: string;
  editable?: boolean;
  nav?: {
    groupLabel: string;
    label: string;
    icon: NavIconKey;
  };
}

export type DashboardPermissionId = string;

export type DashboardPermissionRoleMap = Partial<
  Record<DashboardPermissionId, Role>
>;

export interface DashboardPermissionSummary {
  id: DashboardPermissionId;
  label: string;
  description: string;
  href: string;
  groupLabel: string;
  defaultRole: Role;
  requiredRole: Role;
  isOverride: boolean;
  editable: boolean;
  isNavItem: boolean;
  navLabel: string | null;
}

export interface DashboardNavItem {
  permissionId: DashboardPermissionId;
  label: string;
  href: string;
  requiredRole: Role;
  icon: NavIconKey;
  exactMatch: boolean;
}

export interface DashboardNavGroup {
  label: string;
  items: DashboardNavItem[];
}

export const EDITABLE_PERMISSION_ROLES: Role[] = [
  "everyone",
  "manager",
  "engineering_manager",
  "leadership",
  "ceo",
];

export const DASHBOARD_PERMISSION_DEFINITIONS = [
  {
    id: "dashboard.overview",
    label: "Overview",
    description:
      "Dashboard landing page and hero metrics. Raising this can lock lower roles out of the dashboard root.",
    href: "/dashboard",
    groupLabel: "Overview",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Overview",
      label: "Dashboard",
      icon: "layout-dashboard",
    },
  },
  {
    id: "dashboard.unitEconomics",
    label: "Unit Economics",
    description: "Revenue efficiency, acquisition, and cohort metrics.",
    href: "/dashboard/unit-economics",
    groupLabel: "Performance",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Performance",
      label: "Unit Economics",
      icon: "calculator",
    },
  },
  {
    id: "dashboard.financial",
    label: "Financial",
    description: "Management accounts, P&L, and treasury views.",
    href: "/dashboard/financial",
    groupLabel: "Performance",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Performance",
      label: "Financial",
      icon: "pound-sterling",
    },
  },
  {
    id: "dashboard.product",
    label: "Product",
    description: "Usage, engagement, and retention dashboards.",
    href: "/dashboard/product",
    groupLabel: "Performance",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Performance",
      label: "Product",
      icon: "bar-chart-3",
    },
  },
  {
    id: "dashboard.strategy",
    label: "Strategy",
    description: "Company strategy page.",
    href: "/dashboard/strategy",
    groupLabel: "Goals",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Goals",
      label: "Strategy",
      icon: "compass",
    },
  },
  {
    id: "dashboard.okrs",
    label: "OKRs",
    description: "Objective and key result progress across pillars and squads.",
    href: "/dashboard/okrs",
    groupLabel: "Goals",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Goals",
      label: "OKRs",
      icon: "target",
    },
  },
  {
    id: "dashboard.meetings",
    label: "Meetings",
    description: "Calendar, notes, and meeting prep.",
    href: "/dashboard/meetings",
    groupLabel: "Meetings",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Meetings",
      label: "Meetings",
      icon: "calendar",
    },
  },
  {
    id: "dashboard.people",
    label: "People",
    description: "Org directory, headcount, and people analytics.",
    href: "/dashboard/people",
    groupLabel: "Team",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Team",
      label: "Org",
      icon: "users",
    },
  },
  {
    id: "dashboard.people.performance",
    label: "Performance",
    description: "Performance distributions and individual drill-downs.",
    href: "/dashboard/people/performance",
    groupLabel: "Team",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Team",
      label: "Performance",
      icon: "trending-up",
    },
  },
  {
    id: "dashboard.engineering",
    label: "Engineering",
    description: "Delivery, squad, and engineer activity views.",
    href: "/dashboard/engineering",
    groupLabel: "Team",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Team",
      label: "Engineering",
      icon: "git-pull-request",
    },
  },
  {
    id: "dashboard.managers",
    label: "My Team",
    description: "Manager view for direct reports and team coaching.",
    href: "/dashboard/managers",
    groupLabel: "Team",
    defaultRole: "manager",
    nav: {
      groupLabel: "Team",
      label: "My Team",
      icon: "users",
    },
  },
  {
    id: "dashboard.slack",
    label: "Slack",
    description: "Workspace engagement and member activity.",
    href: "/dashboard/slack",
    groupLabel: "Team",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Team",
      label: "Slack",
      icon: "message-square",
    },
  },
  {
    id: "dashboard.people.engagement",
    label: "Engagement",
    description: "Culture Amp and engagement survey views.",
    href: "/dashboard/people/engagement",
    groupLabel: "Team",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Team",
      label: "Engagement",
      icon: "heart",
    },
  },
  {
    id: "dashboard.admin.enps",
    label: "Happiness",
    description: "eNPS administration and happiness pulse responses.",
    href: "/dashboard/admin/enps",
    groupLabel: "Team",
    defaultRole: "ceo",
    nav: {
      groupLabel: "Team",
      label: "Happiness",
      icon: "heart",
    },
  },
  {
    id: "dashboard.people.attrition",
    label: "Attrition",
    description: "Recent departures and attrition signals.",
    href: "/dashboard/people/attrition",
    groupLabel: "Team",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Team",
      label: "Attrition",
      icon: "trending-up",
    },
  },
  {
    id: "dashboard.people.talent",
    label: "Talent",
    description: "Talent pipeline and recruiter performance.",
    href: "/dashboard/people/talent",
    groupLabel: "Team",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Team",
      label: "Talent",
      icon: "user-plus",
    },
  },
  {
    id: "dashboard.people.headcountPlanning",
    label: "Headcount Planning",
    description: "Open roles, hiring plan, and target tracking.",
    href: "/dashboard/people/headcount-planning",
    groupLabel: "Team",
    defaultRole: "leadership",
    nav: {
      groupLabel: "Team",
      label: "Headcount planning",
      icon: "clipboard-list",
    },
  },
  {
    id: "dashboard.people.aiUsage",
    label: "AI Usage",
    description: "AI tool adoption and usage trends.",
    href: "/dashboard/people/ai-usage",
    groupLabel: "Team",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Team",
      label: "AI Usage",
      icon: "sparkles",
    },
  },
  {
    id: "dashboard.people.dataCleanup",
    label: "Data Cleanup",
    description: "Missing HR data and cleanup workflows.",
    href: "/dashboard/people/data-cleanup",
    groupLabel: "Team",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Team",
      label: "Data Cleanup",
      icon: "alert-triangle",
    },
  },
  {
    id: "dashboard.settings",
    label: "Settings",
    description: "Per-user integrations and preferences.",
    href: "/dashboard/settings",
    groupLabel: "Settings",
    defaultRole: "everyone",
    nav: {
      groupLabel: "Settings",
      label: "Integrations",
      icon: "settings",
    },
  },
  {
    // Locked: this page exposes role mutation and impersonation controls.
    id: "admin.users",
    label: "Users",
    description: "Clerk user admin, role assignment, and impersonation.",
    href: "/dashboard/admin/users",
    groupLabel: "Admin",
    defaultRole: "ceo",
    editable: false,
    nav: {
      groupLabel: "Admin",
      label: "Users",
      icon: "users",
    },
  },
  {
    id: "admin.permissions",
    label: "Permissions",
    description: "Change the minimum role required for dashboard pages.",
    href: "/dashboard/admin/permissions",
    groupLabel: "Admin",
    defaultRole: "ceo",
    editable: false,
    nav: {
      groupLabel: "Admin",
      label: "Permissions",
      icon: "shield",
    },
  },
  {
    id: "admin.squads",
    label: "Squads",
    description:
      "Squad registry management. Lowering this also allows those roles to create and edit squad records.",
    href: "/dashboard/admin/squads",
    groupLabel: "Admin",
    defaultRole: "ceo",
    nav: {
      groupLabel: "Admin",
      label: "Squads",
      icon: "settings",
    },
  },
  {
    // Locked: this page also controls manual sync trigger authority.
    id: "admin.status",
    label: "Data Status",
    description: "Sync health, recent runs, and data source status.",
    href: "/dashboard/admin/status",
    groupLabel: "Admin",
    defaultRole: "ceo",
    editable: false,
    nav: {
      groupLabel: "Admin",
      label: "Data Status",
      icon: "activity",
    },
  },
  {
    id: "admin.modeExplorer",
    label: "Mode Explorer",
    description:
      "Ad-hoc Mode query previews and diagnostics. Lowering this also allows those roles to run Mode admin queries.",
    href: "/dashboard/admin/mode-explorer",
    groupLabel: "Admin",
    defaultRole: "ceo",
    nav: {
      groupLabel: "Admin",
      label: "Mode Explorer",
      icon: "database",
    },
  },
  {
    id: "admin.analytics",
    label: "Analytics",
    description: "Internal usage analytics and page view trends.",
    href: "/dashboard/admin/analytics",
    groupLabel: "Admin",
    defaultRole: "ceo",
    nav: {
      groupLabel: "Admin",
      label: "Analytics",
      icon: "bar-chart-3",
    },
  },
  {
    id: "admin.probes",
    label: "Probes",
    description: "External probes, incidents, and production watchdogs.",
    href: "/dashboard/admin/probes",
    groupLabel: "Admin",
    defaultRole: "ceo",
    nav: {
      groupLabel: "Admin",
      label: "Probes",
      icon: "heart-pulse",
    },
  },
  {
    id: "engineering.impact",
    label: "Engineering Impact",
    description: "Leadership-only engineering impact report.",
    href: "/dashboard/engineering/impact",
    groupLabel: "Team",
    defaultRole: "leadership",
    redirectTo: "/dashboard/engineering",
  },
  {
    id: "engineering.impactModel",
    label: "Impact Model",
    description: "Manager and leadership impact-model coaching page.",
    href: "/dashboard/engineering/impact-model",
    groupLabel: "Team",
    defaultRole: "manager",
    redirectTo: "/dashboard/engineering",
  },
  {
    id: "engineering.codeReview",
    label: "Code Review",
    description: "LLM-reviewed PR analysis for engineering quality.",
    href: "/dashboard/engineering/code-review",
    groupLabel: "Team",
    defaultRole: "engineering_manager",
    redirectTo: "/dashboard/engineering",
  },
  {
    id: "engineering.ranking",
    label: "Engineer Ranking",
    description: "Methodology-first cohort-relative engineer ranking.",
    href: "/dashboard/engineering/ranking",
    groupLabel: "Team",
    defaultRole: "engineering_manager",
    redirectTo: "/dashboard/engineering",
  },
  {
    id: "people.profile",
    label: "Person Profile",
    description: "Individual people profile drill-downs.",
    href: "/dashboard/people/[slug]",
    groupLabel: "Team",
    defaultRole: "manager",
    redirectTo: "/dashboard/people",
  },
] as const satisfies readonly DashboardPermissionDefinition[];

export const DASHBOARD_PERMISSION_IDS = DASHBOARD_PERMISSION_DEFINITIONS.map(
  (definition) => definition.id,
);

function getEffectiveRequiredRole(
  definition: DashboardPermissionDefinition,
  overrides: DashboardPermissionRoleMap,
): Role {
  if (definition.editable === false) {
    return definition.defaultRole;
  }

  return overrides[definition.id] ?? definition.defaultRole;
}

export function getDashboardPermissionDefinition(
  permissionId: DashboardPermissionId,
): DashboardPermissionDefinition {
  const definition = DASHBOARD_PERMISSION_DEFINITIONS.find(
    (item) => item.id === permissionId,
  );

  if (!definition) {
    throw new Error(`Unknown dashboard permission: ${permissionId}`);
  }

  return definition;
}

export function buildDashboardPermissionSummaries(
  overrides: DashboardPermissionRoleMap = {},
): DashboardPermissionSummary[] {
  return DASHBOARD_PERMISSION_DEFINITIONS.map((definition) => {
    const normalizedDefinition = definition as DashboardPermissionDefinition;
    const requiredRole = getEffectiveRequiredRole(
      normalizedDefinition,
      overrides,
    );
    const editable = normalizedDefinition.editable ?? true;

    return {
      id: normalizedDefinition.id,
      label: normalizedDefinition.label,
      description: normalizedDefinition.description,
      href: normalizedDefinition.href,
      groupLabel: normalizedDefinition.groupLabel,
      defaultRole: normalizedDefinition.defaultRole,
      requiredRole,
      isOverride: editable && requiredRole !== normalizedDefinition.defaultRole,
      editable,
      isNavItem: normalizedDefinition.nav != null,
      navLabel: normalizedDefinition.nav?.label ?? null,
    };
  });
}

export function buildDashboardNavGroups(
  overrides: DashboardPermissionRoleMap = {},
): DashboardNavGroup[] {
  const groups = new Map<string, DashboardNavItem[]>();

  for (const definition of DASHBOARD_PERMISSION_DEFINITIONS) {
    const normalizedDefinition = definition as DashboardPermissionDefinition;
    if (!normalizedDefinition.nav) continue;

    const requiredRole = getEffectiveRequiredRole(
      normalizedDefinition,
      overrides,
    );
    const items = groups.get(normalizedDefinition.nav.groupLabel) ?? [];
    items.push({
      permissionId: normalizedDefinition.id,
      label: normalizedDefinition.nav.label,
      href: normalizedDefinition.href,
      requiredRole,
      icon: normalizedDefinition.nav.icon,
      exactMatch: false,
    });
    groups.set(normalizedDefinition.nav.groupLabel, items);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    items: items.map((item) => ({
      ...item,
      exactMatch:
        item.href === "/dashboard" ||
        items.some(
          (sibling) =>
            sibling.href !== item.href &&
            sibling.href.startsWith(item.href + "/"),
        ),
    })),
  }));
}

export function getDashboardSectionLabelMap(): Record<string, string> {
  return DASHBOARD_PERMISSION_DEFINITIONS.reduce<Record<string, string>>(
    (acc, definition) => {
      if (!definition.href.startsWith("/dashboard")) {
        return acc;
      }

      const section = definition.href.replace(/^\/dashboard\/?/, "");
      if (section.length === 0 || section.includes("[")) {
        return acc;
      }

      acc[section] = definition.label;
      return acc;
    },
    { "": "Overview" },
  );
}
