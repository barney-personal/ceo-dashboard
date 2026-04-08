import {
  getModeSyncProfile,
  type ModeQuerySyncProfile,
  type ModeStorageWindow,
} from "@/lib/integrations/mode-config";

export interface PreparedModeQueryData {
  sourceRowCount: number;
  storedRowCount: number;
  truncated: boolean;
  rows: Record<string, unknown>[];
  storageWindow: ModeStorageWindow;
}

function parseDateValue(value: unknown): Date | null {
  if (value == null) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function filterSinceDate(
  rows: Record<string, unknown>[],
  field: string,
  cutoff: Date
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const date = parseDateValue(row[field]);
    return date ? date.getTime() >= cutoff.getTime() : false;
  });
}

function filterLastMonths(
  rows: Record<string, unknown>[],
  field: string,
  months: number
): Record<string, unknown>[] {
  const dates = rows
    .map((row) => parseDateValue(row[field]))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const latest = dates[dates.length - 1];
  if (!latest) return rows;

  const cutoff = new Date(latest);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (months - 1));
  cutoff.setUTCDate(1);

  return filterSinceDate(rows, field, cutoff);
}

function filterLastDays(
  rows: Record<string, unknown>[],
  field: string,
  days: number
): Record<string, unknown>[] {
  const dates = rows
    .map((row) => parseDateValue(row[field]))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const latest = dates[dates.length - 1];
  if (!latest) return rows;

  const cutoff = new Date(latest.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return filterSinceDate(rows, field, cutoff);
}

function filterLastCohorts(
  rows: Record<string, unknown>[],
  field: string,
  count: number
): Record<string, unknown>[] {
  const uniqueKeys = [...new Set(
    rows
      .map((row) => parseDateValue(row[field]))
      .filter((date): date is Date => date !== null)
      .map((date) => date.toISOString().slice(0, 10))
  )].sort();

  const keep = new Set(uniqueKeys.slice(-count));

  return rows.filter((row) => {
    const date = parseDateValue(row[field]);
    return date ? keep.has(date.toISOString().slice(0, 10)) : false;
  });
}

export function getModeQuerySyncProfile(
  reportToken: string,
  queryName: string
): ModeQuerySyncProfile | undefined {
  const report = getModeSyncProfile(reportToken);
  return report?.queries.find((query) => query.name === queryName);
}

export function shouldSyncModeReport(reportToken: string): boolean {
  return getModeSyncProfile(reportToken)?.syncEnabled ?? false;
}

export function prepareModeRowsForStorage(
  rows: Record<string, unknown>[],
  queryProfile: ModeQuerySyncProfile
): PreparedModeQueryData {
  const sourceRowCount = rows.length;
  let storedRows = rows;

  switch (queryProfile.storageWindow.kind) {
    case "all":
    case "snapshot":
      storedRows = rows;
      break;
    case "since-date":
      storedRows = filterSinceDate(
        rows,
        queryProfile.storageWindow.field,
        new Date(queryProfile.storageWindow.since)
      );
      break;
    case "last-months":
      storedRows = filterLastMonths(
        rows,
        queryProfile.storageWindow.field,
        queryProfile.storageWindow.months
      );
      break;
    case "last-days":
      storedRows = filterLastDays(
        rows,
        queryProfile.storageWindow.field,
        queryProfile.storageWindow.days
      );
      break;
    case "last-cohorts":
      storedRows = filterLastCohorts(
        rows,
        queryProfile.storageWindow.field,
        queryProfile.storageWindow.count
      );
      break;
    case "full-if-under":
      storedRows =
        rows.length <= queryProfile.storageWindow.maxRows
          ? rows
          : rows.slice(-queryProfile.storageWindow.maxRows);
      break;
  }

  return {
    sourceRowCount,
    storedRowCount: storedRows.length,
    truncated: storedRows.length !== sourceRowCount,
    rows: storedRows,
    storageWindow: queryProfile.storageWindow,
  };
}
