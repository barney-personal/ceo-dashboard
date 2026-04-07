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

export interface ModeChartEmbed {
  url: string;
  title: string;
  section: DashboardSection;
  category?: string;
  height?: number;
}

/**
 * Map of Mode reports to dashboard sections (for data sync).
 */
export const MODE_REPORT_MAP: ModeReportConfig[] = [
  // --- Unit Economics ---
  {
    reportToken: "11c3172037ac",
    name: "Strategic Finance KPIs",
    section: "unit-economics",
    category: "kpis",
  },
  {
    reportToken: "76bc42f598a7",
    name: "Premium Conversion Dashboard",
    section: "unit-economics",
    category: "conversion",
  },
  {
    reportToken: "774f14224dd9",
    name: "Growth Marketing Performance",
    section: "unit-economics",
    category: "cac",
  },
  {
    reportToken: "9c02ab407985",
    name: "Retention Dashboard",
    section: "unit-economics",
    category: "retention",
  },
  {
    reportToken: "9da7db154e14",
    name: "Arrears Monitoring Deep Dive",
    section: "unit-economics",
    category: "cogs",
  },

  // --- Financial ---
  {
    reportToken: "10b1f099768d",
    name: "Seasonality Overview",
    section: "financial",
    category: "seasonality",
  },

  // --- OKRs ---
  {
    reportToken: "b301cc0c9572",
    name: "Company OKR Dashboard - T1-26",
    section: "okrs",
    category: "company",
  },

  // --- People ---
  {
    reportToken: "c458b52ceb68",
    name: "Headcount SSoT Dashboard",
    section: "people",
    category: "headcount",
  },
];

/**
 * Mode chart embeds — specific visualisations from Jago's dashboard.
 * These are rendered as iframes in the dashboard pages.
 */
export const MODE_CHART_EMBEDS: ModeChartEmbed[] = [
  // --- Unit Economics ---
  {
    url: "https://app.mode.com/cleoai/reports/11c3172037ac/viz/b834503b4991/explore",
    title: "Strategic Finance KPIs — Overview",
    section: "unit-economics",
    category: "kpis",
  },
  {
    url: "https://app.mode.com/cleoai/reports/11c3172037ac/viz/e1fcec6d6c6f/explore",
    title: "Strategic Finance KPIs — Detail",
    section: "unit-economics",
    category: "kpis",
  },
  {
    url: "https://app.mode.com/cleoai/reports/76bc42f598a7/viz/7b72a2bce97a/explore",
    title: "Premium Conversion Dashboard",
    section: "unit-economics",
    category: "conversion",
  },
  {
    url: "https://app.mode.com/cleoai/reports/774f14224dd9/viz/8da4a53042b9/explore",
    title: "Growth Marketing Performance",
    section: "unit-economics",
    category: "cac",
  },
  {
    url: "https://app.mode.com/cleoai/reports/9da7db154e14/viz/85ba5ebd160f/explore",
    title: "Arrears Monitoring — Overview",
    section: "unit-economics",
    category: "cogs",
  },
  {
    url: "https://app.mode.com/cleoai/reports/9da7db154e14/viz/f90a8736ccd9/explore",
    title: "Arrears Monitoring — Detail",
    section: "unit-economics",
    category: "cogs",
  },
  {
    url: "https://app.mode.com/cleoai/reports/9c02ab407985/viz/a78655bb88d9/explore",
    title: "Retention Dashboard",
    section: "unit-economics",
    category: "retention",
  },

  // --- Financial ---
  {
    url: "https://app.mode.com/cleoai/reports/10b1f099768d/viz/1dd17f9b8f0b/explore",
    title: "Seasonality Overview",
    section: "financial",
    category: "seasonality",
  },

  // --- OKRs ---
  {
    url: "https://app.mode.com/cleoai/reports/b301cc0c9572",
    title: "Company OKR Dashboard",
    section: "okrs",
    category: "company",
    height: 800,
  },

  // --- People ---
  {
    url: "https://app.mode.com/cleoai/reports/c458b52ceb68",
    title: "Headcount SSoT Dashboard",
    section: "people",
    category: "headcount",
    height: 700,
  },
];

/**
 * Get chart embeds for a dashboard section, optionally filtered by category.
 */
export function getChartEmbeds(
  section: DashboardSection,
  category?: string
): ModeChartEmbed[] {
  return MODE_CHART_EMBEDS.filter(
    (e) => e.section === section && (!category || e.category === category)
  );
}
