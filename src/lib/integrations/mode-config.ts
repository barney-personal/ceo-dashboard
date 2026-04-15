import { CHART_HISTORY_START_DATE } from "@/lib/config/charts";
import { weeklyRetentionAggregator } from "./mode-aggregators";

export type DashboardSection =
  | "unit-economics"
  | "financial"
  | "product"
  | "okrs"
  | "people";

export interface ModeReportConfig {
  reportToken: string;
  name: string;
  section: DashboardSection;
  category?: string;
}

export type ModeStorageWindow =
  | { kind: "all" }
  | { kind: "since-date"; field: string; since: string }
  | { kind: "last-months"; field: string; months: number }
  | { kind: "last-days"; field: string; days: number }
  | { kind: "last-cohorts"; field: string; count: number }
  | { kind: "snapshot" }
  | { kind: "full-if-under"; maxRows: number };

/**
 * Streaming row aggregator. When set, the sync worker fetches the query
 * result as CSV and feeds each row through `reduce` instead of buffering the
 * full JSON payload in memory. Use this for very large datasets where we only
 * need a small aggregated subset (e.g. weekly retention rolled up across
 * segment dimensions).
 */
export type ModeRowAggregator<TAggregated = unknown> = {
  /** Initial state passed to the first `reduce` call. */
  initial: () => TAggregated;
  /** Called once per CSV row. May mutate or return a new state. */
  reduce: (
    state: TAggregated,
    row: Record<string, string>,
  ) => TAggregated;
  /** Convert the final state to plain rows for storage in `mode_report_data`. */
  finalize: (state: TAggregated) => Record<string, unknown>[];
  /** Optional column metadata to persist alongside the aggregated rows. */
  columns?: Array<{ name: string; type: string }>;
};

export interface ModeQuerySyncProfile {
  name: string;
  storageWindow: ModeStorageWindow;
  /**
   * Optional override for the per-query Mode response size cap (bytes). The
   * default cap (`MODE_MAX_RESULT_BYTES`, 25 MB) is enough for most queries,
   * but very wide datasets — e.g. weekly retention broken down by segment —
   * exceed that before the storage window can filter rows down. Set this to
   * raise the buffered download cap for the affected query only. Ignored when
   * `aggregator` is set (streaming has no buffered cap).
   */
  maxResponseBytes?: number;
  /**
   * Optional streaming aggregator. When provided, the sync worker streams the
   * Mode CSV result and feeds each row through this aggregator rather than
   * buffering the JSON response. The aggregated rows are stored in place of
   * the raw payload, which keeps memory bounded regardless of source size.
   * `storageWindow` is ignored for aggregated profiles — the aggregator owns
   * the row shape end-to-end.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aggregator?: ModeRowAggregator<any>;
}

export interface ModeSyncProfile extends ModeReportConfig {
  syncEnabled: boolean;
  queries: ModeQuerySyncProfile[];
}

export interface ModeChartEmbed {
  url: string;
  title: string;
  section: DashboardSection;
  category?: string;
  height?: number;
}

export const MODE_WORKSPACE_SLUG = "cleoai";

export function buildModeReportUrl(reportToken: string): string {
  return `https://app.mode.com/${MODE_WORKSPACE_SLUG}/reports/${reportToken}`;
}

export function buildModeExploreUrl(
  reportToken: string,
  vizToken: string,
): string {
  return `${buildModeReportUrl(reportToken)}/viz/${vizToken}/explore`;
}

/**
 * Map of Mode reports to dashboard sections (for data sync).
 */
export const MODE_SYNC_PROFILES: ModeSyncProfile[] = [
  // --- Unit Economics ---
  {
    reportToken: "11c3172037ac",
    name: "Strategic Finance KPIs",
    section: "unit-economics",
    category: "kpis",
    syncEnabled: true,
    queries: [
      { name: "36M LTV", storageWindow: { kind: "all" } },
      { name: "ARPU Annualized", storageWindow: { kind: "all" } },
      { name: "CPA", storageWindow: { kind: "all" } },
      { name: "M11 Plus CVR, past 7 days", storageWindow: { kind: "all" } },
      {
        name: "Subscribers at end of period: Growth accounting",
        storageWindow: { kind: "all" },
      },
      {
        name: "Query 3",
        storageWindow: {
          kind: "since-date",
          field: "day",
          since: CHART_HISTORY_START_DATE,
        },
      },
      {
        name: "Query 4",
        storageWindow: {
          kind: "last-months",
          field: "month",
          months: 84,
        },
      },
    ],
  },
  {
    reportToken: "76bc42f598a7",
    name: "Premium Conversion Dashboard",
    section: "unit-economics",
    category: "conversion",
    syncEnabled: true,
    queries: [
      {
        name: "agg_cohort_conversion_rate_by_window",
        storageWindow: { kind: "all" },
      },
      {
        name: "indexed_conversion_rates_with_2022_baseline",
        storageWindow: { kind: "all" },
      },
      {
        name: "Query 2",
        storageWindow: { kind: "all" },
      },
    ],
  },
  {
    reportToken: "774f14224dd9",
    name: "Growth Marketing Performance",
    section: "unit-economics",
    category: "cac",
    syncEnabled: true,
    queries: [
      {
        name: "LTV:Paid CAC",
        storageWindow: {
          kind: "since-date",
          field: "period",
          since: CHART_HISTORY_START_DATE,
        },
      },
    ],
  },
  {
    reportToken: "9c02ab407985",
    name: "Retention Dashboard",
    section: "unit-economics",
    category: "retention",
    syncEnabled: true,
    queries: [
      {
        name: "Query 1",
        storageWindow: {
          kind: "last-cohorts",
          field: "subscriber_cohort",
          count: 24,
        },
      },
    ],
  },
  {
    reportToken: "9da7db154e14",
    name: "Arrears Monitoring Deep Dive",
    section: "unit-economics",
    category: "cogs",
    syncEnabled: false,
    queries: [],
  },

  // --- Product ---
  {
    reportToken: "56f94e35c537",
    name: "App Active Users",
    section: "product",
    category: "active-users",
    syncEnabled: true,
    queries: [
      {
        name: "dau-wau-mau query all time",
        storageWindow: {
          kind: "last-days",
          field: "date",
          days: 730,
        },
      },
    ],
  },
  {
    reportToken: "5a033d810ddc",
    name: "App Retention",
    section: "product",
    category: "retention",
    syncEnabled: true,
    queries: [
      {
        name: "Query 1",
        storageWindow: {
          kind: "last-cohorts",
          field: "cohort_month",
          count: 24,
        },
      },
    ],
  },
  {
    // Source report for the "dataset_app_activity_retention_weekly" dataset
    // imported into App Retention (5a033d810ddc). Synced directly here so
    // we get the underlying weekly cohort rows.
    reportToken: "4e4ed264ed7a",
    name: "App Retention Weekly",
    section: "product",
    category: "retention-weekly",
    syncEnabled: true,
    queries: [
      {
        // The full query is ~230k rows broken down by segment dimensions
        // (d30_subscriber, age, user_segment, core_intent). The CSV stream is
        // ~90 MB and the JSON variant balloons to >200 MB. We don't need any
        // of the segment dimensions for the WAU triangle, so we stream the
        // CSV and roll rows up to (cohort_week, relative_moving_week,
        // active_users_weekly) on the fly. That keeps peak heap bounded
        // regardless of source size and shrinks storage from ~230k rows to
        // ~1.4k. `storageWindow` is unused for aggregated profiles but kept
        // so the schema stays uniform.
        name: "Query 1",
        storageWindow: { kind: "all" },
        aggregator: weeklyRetentionAggregator,
      },
    ],
  },

  // --- Financial ---
  {
    reportToken: "10b1f099768d",
    name: "Seasonality Overview",
    section: "financial",
    category: "seasonality",
    syncEnabled: false,
    queries: [],
  },

  // --- OKRs ---
  {
    reportToken: "b301cc0c9572",
    name: "Company OKR Dashboard - T1-26",
    section: "okrs",
    category: "company",
    syncEnabled: true,
    queries: [
      {
        name: "OKR Reporting",
        storageWindow: { kind: "full-if-under", maxRows: 5000 },
      },
      {
        name: "User Acquisition",
        storageWindow: { kind: "full-if-under", maxRows: 5000 },
      },
    ],
  },

  // --- People ---
  {
    reportToken: "25a607aa5c6c",
    name: "Current FTEs",
    section: "people",
    category: "org",
    syncEnabled: true,
    queries: [
      { name: "current_employees", storageWindow: { kind: "snapshot" } },
    ],
  },
  {
    reportToken: "c458b52ceb68",
    name: "Headcount SSoT Dashboard",
    section: "people",
    category: "headcount",
    syncEnabled: true,
    queries: [{ name: "headcount", storageWindow: { kind: "snapshot" } }],
  },
  {
    reportToken: "79ea96d310a9",
    name: "Performance Dashboard",
    section: "people",
    category: "performance",
    syncEnabled: false,
    queries: [],
  },
  {
    reportToken: "47715a0cccf7",
    name: "Attrition Tracker",
    section: "people",
    category: "attrition",
    syncEnabled: true,
    queries: [
      {
        name: "attrition",
        storageWindow: {
          kind: "last-months",
          field: "reporting_period",
          months: 36,
        },
      },
      {
        name: "attrition_within_1y_joining",
        storageWindow: {
          kind: "last-months",
          field: "start_month",
          months: 36,
        },
      },
      {
        name: "Query 2",
        storageWindow: { kind: "snapshot" },
      },
      {
        name: "employees",
        storageWindow: { kind: "all" },
      },
    ],
  },
];

function toModeReportConfig(profile: ModeSyncProfile): ModeReportConfig {
  return {
    reportToken: profile.reportToken,
    name: profile.name,
    section: profile.section,
    category: profile.category,
  };
}

export const MODE_REPORT_MAP: ModeReportConfig[] =
  MODE_SYNC_PROFILES.map(toModeReportConfig);

const MODE_REPORT_BY_SECTION_CATEGORY = new Map<
  string,
  ModeReportConfig & { category: string }
>(
  MODE_REPORT_MAP.filter(
    (report): report is ModeReportConfig & { category: string } =>
      Boolean(report.category),
  ).map((report) => [`${report.section}:${report.category}`, report]),
);

export function getModeSyncProfile(
  reportToken: string,
): ModeSyncProfile | undefined {
  return MODE_SYNC_PROFILES.find(
    (profile) => profile.reportToken === reportToken,
  );
}

export function getModeReportLink(
  section: DashboardSection,
  category: string,
): string {
  const report = MODE_REPORT_BY_SECTION_CATEGORY.get(`${section}:${category}`);

  if (!report) {
    throw new Error(
      `Missing Mode report configuration for ${section}:${category}`,
    );
  }

  return buildModeReportUrl(report.reportToken);
}

/**
 * Mode chart embeds — specific visualisations from Jago's dashboard.
 * These are rendered as iframes in the dashboard pages.
 */
export const MODE_CHART_EMBEDS: ModeChartEmbed[] = [
  // --- Unit Economics ---
  {
    url: buildModeExploreUrl("11c3172037ac", "b834503b4991"),
    title: "Strategic Finance KPIs — Overview",
    section: "unit-economics",
    category: "kpis",
  },
  {
    url: buildModeExploreUrl("11c3172037ac", "e1fcec6d6c6f"),
    title: "Strategic Finance KPIs — Detail",
    section: "unit-economics",
    category: "kpis",
  },
  {
    url: buildModeExploreUrl("76bc42f598a7", "7b72a2bce97a"),
    title: "Premium Conversion Dashboard",
    section: "unit-economics",
    category: "conversion",
  },
  {
    url: buildModeExploreUrl("774f14224dd9", "8da4a53042b9"),
    title: "Growth Marketing Performance",
    section: "unit-economics",
    category: "cac",
  },
  {
    url: buildModeExploreUrl("9da7db154e14", "85ba5ebd160f"),
    title: "Arrears Monitoring — Overview",
    section: "unit-economics",
    category: "cogs",
  },
  {
    url: buildModeExploreUrl("9da7db154e14", "f90a8736ccd9"),
    title: "Arrears Monitoring — Detail",
    section: "unit-economics",
    category: "cogs",
  },
  {
    url: buildModeExploreUrl("9c02ab407985", "a78655bb88d9"),
    title: "Retention Dashboard",
    section: "unit-economics",
    category: "retention",
  },

  // --- Financial ---
  {
    url: buildModeExploreUrl("10b1f099768d", "1dd17f9b8f0b"),
    title: "Seasonality Overview",
    section: "financial",
    category: "seasonality",
  },

  // --- OKRs ---
  {
    url: buildModeReportUrl("b301cc0c9572"),
    title: "Company OKR Dashboard",
    section: "okrs",
    category: "company",
    height: 800,
  },

  // --- People ---
  {
    url: buildModeReportUrl("c458b52ceb68"),
    title: "Headcount SSoT Dashboard",
    section: "people",
    category: "headcount",
    height: 700,
  },
  {
    url: buildModeReportUrl("79ea96d310a9"),
    title: "Performance Dashboard",
    section: "people",
    category: "performance",
    height: 700,
  },
  {
    url: buildModeReportUrl("47715a0cccf7"),
    title: "Attrition Tracker",
    section: "people",
    category: "attrition",
    height: 800,
  },
];

export type ModeReportSyncControl = {
  name: string;
  reportToken: string;
  section: string;
  modeUrl: string;
};

/**
 * Build the list of Mode report controls for the admin sync UI.
 *
 * Sources from the canonical MODE_SYNC_PROFILES config (not DB rows), so the
 * list is always populated even on a fresh database before any sync has run.
 *
 * @param inactiveTokens - Set of report tokens that are marked inactive in the
 *   DB. Any token in this set is excluded. Pass an empty Set (the default) when
 *   the DB has no rows yet — all sync-enabled profiles are then visible.
 */
export function getSyncEnabledModeReportControls(
  inactiveTokens: ReadonlySet<string> = new Set()
): ModeReportSyncControl[] {
  return MODE_SYNC_PROFILES.filter(
    (profile) => profile.syncEnabled && !inactiveTokens.has(profile.reportToken)
  )
    .sort((a, b) => {
      const sectionOrder = a.section.localeCompare(b.section);
      return sectionOrder !== 0 ? sectionOrder : a.name.localeCompare(b.name);
    })
    .map((profile) => ({
      name: profile.name,
      reportToken: profile.reportToken,
      section: profile.section,
      modeUrl: buildModeReportUrl(profile.reportToken),
    }));
}

/**
 * Build a token → name lookup map for all Mode reports from config.
 *
 * Use this instead of building the map from DB rows so that report names are
 * available even before a sync has seeded the mode_reports table.
 */
export function getModeReportNamesByToken(): Map<string, string> {
  return new Map(MODE_SYNC_PROFILES.map((p) => [p.reportToken, p.name]));
}

/**
 * Get chart embeds for a dashboard section, optionally filtered by category.
 */
export function getChartEmbeds(
  section: DashboardSection,
  category?: string,
): ModeChartEmbed[] {
  return MODE_CHART_EMBEDS.filter(
    (e) => e.section === section && (!category || e.category === category),
  );
}
