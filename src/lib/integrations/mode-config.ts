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

/**
 * Map of Mode reports to dashboard sections.
 *
 * To add a new report:
 * 1. Find the report token in Mode (URL: app.mode.com/{workspace}/reports/{token})
 * 2. Add an entry below with the section and optional category
 * 3. Trigger a sync to pull the data
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

  // --- Product ---
  // (No reports yet — MAUs/WAUs, social capital, engagement to be added)

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
