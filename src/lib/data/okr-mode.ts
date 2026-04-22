import { getReportData, rowNumOrNull, rowStr } from "./mode";

export type KrFormat = "percent" | "currency" | "integer" | "thousands";

export interface KrSnapshot {
  month: string; // ISO month e.g. "2026-02-01"
  value: number;
}

export interface ModeKr {
  level: "Company" | "Pillar" | "Squad";
  krType: string; // raw e.g. "Squad - Growth Marketing"
  squad: string | null; // stripped squad name if level === "Squad"
  pillar: string | null; // stripped pillar name if level === "Pillar"
  description: string;
  format: KrFormat;
  baseline: number | null;
  target: number | null;
  current: number | null; // latest snapshot value
  currentMonth: string | null;
  previous: number | null; // second-most-recent snapshot value
  previousMonth: string | null;
  snapshots: KrSnapshot[];
}

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

  for (const row of rows) {
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

    if (month && current != null) {
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
 * Progress from baseline to target, clamped to [0, 1]. Returns null if unmeasurable.
 * Handles both "higher is better" (target > baseline) and "lower is better" (target < baseline).
 */
export function progressTowardTarget(kr: ModeKr): number | null {
  if (kr.baseline == null || kr.target == null || kr.current == null) {
    return null;
  }
  const span = kr.target - kr.baseline;
  if (span === 0) return kr.current >= kr.target ? 1 : 0;
  const raw = (kr.current - kr.baseline) / span;
  return Math.max(0, Math.min(1, raw));
}

export type KrTrend = "up" | "down" | "flat" | "unknown";

/**
 * Direction of the month-over-month change, as polarity relative to the target.
 * "up" means moving toward target; "down" means away.
 */
export function krTrend(kr: ModeKr): KrTrend {
  if (kr.current == null || kr.previous == null) return "unknown";
  const delta = kr.current - kr.previous;
  if (delta === 0) return "flat";
  if (kr.baseline == null || kr.target == null) {
    return delta > 0 ? "up" : "down";
  }
  const higherIsBetter = kr.target >= kr.baseline;
  const towardTarget = higherIsBetter ? delta > 0 : delta < 0;
  return towardTarget ? "up" : "down";
}

export function formatKrValue(value: number | null, format: KrFormat): string {
  if (value == null) return "—";
  if (format === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (format === "currency") {
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
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
  const squad = all.filter((k) => k.level === "Squad" && k.squad);

  const bySquad = new Map<string, ModeKr[]>();
  for (const kr of squad) {
    if (!kr.squad) continue;
    const existing = bySquad.get(kr.squad) ?? [];
    existing.push(kr);
    bySquad.set(kr.squad, existing);
  }

  return { company, pillar, squad, bySquad, lastSync: query.syncedAt };
}
