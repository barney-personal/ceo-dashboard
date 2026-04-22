import { getReportData, rowNumOrNull, rowStr } from "./mode";
import type { KrFormat, KrSnapshot, ModeKr } from "./okr-mode-shared";

export type { KrFormat, KrSnapshot, ModeKr, KrTrend } from "./okr-mode-shared";
export {
  formatKrValue,
  hasCurrentValue,
  krTrend,
  needsAttention,
  progressTowardTarget,
} from "./okr-mode-shared";

const SQUAD_PREFIX = "Squad - ";
const PILLAR_PREFIX = "Pillar - ";

function parseFormat(raw: string): KrFormat {
  if (raw.includes("%")) return "percent";
  if (raw.includes("$")) return "currency";
  if (raw.toLowerCase() === "k") return "thousands";
  return "integer";
}

function parseLevel(raw: string): ModeKr["level"] | null {
  if (raw === "Company") return "Company";
  if (raw === "Pillar") return "Pillar";
  if (raw === "Squad") return "Squad";
  return null;
}

function normalizeMonth(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

interface RawRow extends Record<string, unknown> {
  kr_level?: unknown;
  kr_type?: unknown;
  kr_description?: unknown;
  kr_baseline_value?: unknown;
  kr_current_value?: unknown;
  kr_target_value?: unknown;
  format?: unknown;
  reporting_month?: unknown;
}

/**
 * Shape raw Mode rows into a KR-keyed list with monthly snapshots sorted chronologically.
 * Exported for unit tests — the page code calls `getModeOkrs()`.
 */
export function buildModeKrs(rows: RawRow[]): ModeKr[] {
  interface Acc {
    level: ModeKr["level"];
    krType: string;
    description: string;
    format: KrFormat;
    baseline: number | null;
    target: number | null;
    snapshots: KrSnapshot[];
  }

  const byKey = new Map<string, Acc>();

  // Process rows with the newest reporting_month first. The "only fill if
  // still null" logic below then picks up baseline/target from the latest
  // dated row, so target revisions over time aren't masked by whichever row
  // happened to sort first.
  const sortedRows = [...rows].sort((a, b) => {
    const ma = normalizeMonth(rowStr(a, "reporting_month")) ?? "";
    const mb = normalizeMonth(rowStr(b, "reporting_month")) ?? "";
    if (ma === mb) return 0;
    if (!ma) return 1; // undated rows sort to the end
    if (!mb) return -1;
    return mb.localeCompare(ma); // newest first
  });

  for (const row of sortedRows) {
    const level = parseLevel(rowStr(row, "kr_level"));
    const krType = rowStr(row, "kr_type");
    const description = rowStr(row, "kr_description");
    if (!level || !krType || !description) continue;

    const key = `${krType}::${description}`;
    const month = normalizeMonth(rowStr(row, "reporting_month"));
    const current = rowNumOrNull(row, "kr_current_value");
    const baseline = rowNumOrNull(row, "kr_baseline_value");
    const target = rowNumOrNull(row, "kr_target_value");
    const format = parseFormat(rowStr(row, "format"));

    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        level,
        krType,
        description,
        format,
        baseline,
        target,
        snapshots: [],
      };
      byKey.set(key, acc);
    } else {
      if (acc.baseline == null && baseline != null) acc.baseline = baseline;
      if (acc.target == null && target != null) acc.target = target;
    }

    // Rows are processed newest-first, so the first snapshot we see for a
    // given month is the authoritative one — skip any later row that repeats
    // the same month to guard against duplicate appends from Mode re-runs.
    if (
      month &&
      current != null &&
      !acc.snapshots.some((s) => s.month === month)
    ) {
      acc.snapshots.push({ month, value: current });
    }
  }

  return [...byKey.values()].map((acc) => {
    const snapshots = acc.snapshots
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month));
    const latest = snapshots[snapshots.length - 1] ?? null;
    const previous = snapshots[snapshots.length - 2] ?? null;

    return {
      level: acc.level,
      krType: acc.krType,
      squad:
        acc.level === "Squad" && acc.krType.startsWith(SQUAD_PREFIX)
          ? acc.krType.slice(SQUAD_PREFIX.length)
          : null,
      pillar:
        acc.level === "Pillar" && acc.krType.startsWith(PILLAR_PREFIX)
          ? acc.krType.slice(PILLAR_PREFIX.length)
          : null,
      description: acc.description,
      format: acc.format,
      baseline: acc.baseline,
      target: acc.target,
      current: latest?.value ?? null,
      currentMonth: latest?.month ?? null,
      previous: previous?.value ?? null,
      previousMonth: previous?.month ?? null,
      snapshots,
    };
  });
}

/**
 * Load and shape all Mode OKR Reporting rows, grouped by level.
 */
export async function getModeOkrs(): Promise<{
  company: ModeKr[];
  pillar: ModeKr[];
  squad: ModeKr[];
  bySquad: Map<string, ModeKr[]>;
  lastSync: Date | null;
}> {
  const data = await getReportData("okrs", "company");
  const query = data.find((d) => d.queryName === "OKR Reporting");
  if (!query) {
    return {
      company: [],
      pillar: [],
      squad: [],
      bySquad: new Map(),
      lastSync: null,
    };
  }

  const all = buildModeKrs(query.rows as RawRow[]);
  const company = all.filter((k) => k.level === "Company");
  const pillar = all.filter((k) => k.level === "Pillar");
  // Only count squad KRs that are actually reporting a current value —
  // otherwise the "N KR tracked" badges overstate Mode coverage for squads
  // whose KR was defined before the first measurement landed.
  const squad = all.filter(
    (k) => k.level === "Squad" && k.squad && k.current != null,
  );

  const bySquad = new Map<string, ModeKr[]>();
  for (const kr of squad) {
    if (!kr.squad) continue;
    const existing = bySquad.get(kr.squad) ?? [];
    existing.push(kr);
    bySquad.set(kr.squad, existing);
  }

  return { company, pillar, squad, bySquad, lastSync: query.syncedAt };
}
