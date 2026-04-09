export interface QuerySummary {
  id: number;
  reportId: number;
  queryToken: string;
  queryName: string;
  rowCount: number;
  sourceRowCount: number;
  storedRowCount: number;
  truncated: boolean;
  storageWindow: unknown;
  columns: Array<{ name: string; type: string }>;
  syncedAt: string;
}

export interface ReportSummary {
  id: number;
  reportToken: string;
  name: string;
  section: string;
  category: string | null;
  isActive: boolean;
}
