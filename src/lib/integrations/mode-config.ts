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
  category?: string; // Sub-grouping: 'ltv', 'cac', 'revenue', etc.
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
  // { reportToken: "REPLACE_ME", name: "LTV Analysis", section: "unit-economics", category: "ltv" },
  // { reportToken: "REPLACE_ME", name: "CAC by Channel", section: "unit-economics", category: "cac" },

  // --- Financial ---
  // { reportToken: "REPLACE_ME", name: "Revenue Model", section: "financial", category: "revenue" },

  // --- Product ---
  // { reportToken: "REPLACE_ME", name: "Product Metrics", section: "product" },

  // --- OKRs ---
  // { reportToken: "REPLACE_ME", name: "OKR Metrics", section: "okrs" },

  // --- People ---
  // { reportToken: "REPLACE_ME", name: "People Metrics", section: "people" },
];
