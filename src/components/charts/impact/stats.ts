/**
 * Shared statistical helpers for impact-analysis charts.
 *
 * These exist alongside d3-array but are kept local for:
 *  - tighter types (d3's quantile returns number | undefined)
 *  - a Gaussian KDE with Silverman-rule bandwidth (not in d3-array)
 *  - ramp-up curve computation specific to our tenure-bucket shape
 */

import type {
  ImpactEngineer,
  ImpactTenureBucket,
} from "@/lib/data/engineering-impact";

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values: number[]): number {
  return percentile(values, 0.5);
}

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function deviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (values.length - 1));
}

export interface KdeOptions {
  bw?: number;
  min?: number;
  max?: number;
  gridN?: number;
}

export function kde(values: number[], opts: KdeOptions = {}): [number, number][] {
  const xs = values.slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n < 2) return [];
  const sd = deviation(xs) || 1;
  const iqr = (percentile(xs, 0.75) - percentile(xs, 0.25)) / 1.34;
  const bw = opts.bw ?? 0.9 * Math.min(sd, iqr || sd) * Math.pow(n, -0.2);
  const min = opts.min ?? xs[0];
  const max = opts.max ?? xs[n - 1];
  const gridN = opts.gridN ?? 120;
  const step = (max - min) / (gridN - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < gridN; i++) {
    const x = min + i * step;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const u = (x - xs[j]) / bw;
      sum += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }
    out.push([x, sum / (n * bw)]);
  }
  return out;
}

export function rollingMedian(arr: number[], window = 3): number[] {
  const half = Math.floor(window / 2);
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - half), i + half + 1);
    return median(slice);
  });
}

// ─── Ramp-up computation ─────────────────────────────────────────────

export interface RampRow {
  month: number;
  n: number;
  p25?: number;
  p50?: number;
  p75?: number;
  meanValue?: number;
}

/**
 * For each tenure month up to maxMonth, compute a per-engineer 90-day
 * rolling impact by summing buckets [M-2, M-1, M] (in-window only) then
 * applying the impact formula; aggregate across engineers matching the
 * filter as p25/p50/p75.
 *
 * Why 90-day rolling over per-30d medians: 30-day buckets collapse to
 * zero at higher tenure because legitimate bench weeks, OOO, and
 * non-PR work create zero-impact months. 90-day rolling is also the
 * metric the main engineering dashboard already exposes.
 */
export function computeRampUp(
  buckets: ImpactTenureBucket[],
  byEmail: Map<string, ImpactEngineer>,
  filterFn: (e: ImpactEngineer) => boolean = () => true,
  opts: { maxMonth?: number } = {},
): RampRow[] {
  const maxMonth = opts.maxMonth ?? 36;
  const perEmail = new Map<string, Map<number, ImpactTenureBucket>>();
  for (const b of buckets) {
    const e = byEmail.get(b.email);
    if (!e || !filterFn(e)) continue;
    let bm = perEmail.get(b.email);
    if (!bm) {
      bm = new Map();
      perEmail.set(b.email, bm);
    }
    bm.set(b.tenureMonth, b);
  }

  const perMonth = new Map<number, number[]>();
  for (let m = 0; m <= maxMonth; m++) perMonth.set(m, []);

  for (const [, bm] of perEmail) {
    for (let m = 0; m <= maxMonth; m++) {
      const windowBuckets: ImpactTenureBucket[] = [];
      for (let delta = 0; delta <= 2; delta++) {
        const bkt = bm.get(m - delta);
        if (bkt && bkt.inWindow) windowBuckets.push(bkt);
      }
      const minRequired = m < 2 ? Math.min(m + 1, 2) : 2;
      if (windowBuckets.length < minRequired) continue;
      let prs = 0;
      let add = 0;
      let del = 0;
      for (const w of windowBuckets) {
        prs += w.prs;
        add += w.additions;
        del += w.deletions;
      }
      const imp = prs > 0 ? Math.round(prs * Math.log2(1 + (add + del) / prs)) : 0;
      perMonth.get(m)!.push(imp);
    }
  }

  const rows: RampRow[] = [];
  for (let m = 0; m <= maxMonth; m++) {
    const vs = perMonth.get(m)!;
    if (!vs.length) {
      rows.push({ month: m, n: 0 });
      continue;
    }
    rows.push({
      month: m,
      n: vs.length,
      p25: percentile(vs, 0.25),
      p50: median(vs),
      p75: percentile(vs, 0.75),
      meanValue: mean(vs),
    });
  }
  return rows;
}

export interface SteadyStateInfo {
  value: number;
  n: number;
}

/**
 * Steady-state estimate from engineers whose tenure_now >= minTenure
 * months, using their direct impact_90d. Much more stable than any
 * single-tenure-month cohort.
 */
export function steadyStateFromEngineers(
  engineers: ImpactEngineer[],
  filterFn: (e: ImpactEngineer) => boolean = () => true,
  minTenure = 18,
): SteadyStateInfo | null {
  const vs = engineers
    .filter(
      (e) =>
        e.isMatched &&
        e.tenureMonthsNow >= minTenure &&
        filterFn(e) &&
        e.impact90d >= 0,
    )
    .map((e) => e.impact90d);
  if (vs.length < 5) return null;
  return { value: median(vs), n: vs.length };
}

export function timeToTarget(
  rows: RampRow[],
  target: number,
  opts: { roll?: number } = {},
): number | null {
  const roll = opts.roll ?? 3;
  const p50s = rows.map((r) => r.p50 ?? 0);
  const rolled = rollingMedian(p50s, roll);
  for (let i = 0; i < rows.length; i++) {
    if (rolled[i] >= target && (rows[i].n ?? 0) >= 3) return rows[i].month;
  }
  return null;
}

// ─── Peer-relative stats (watchlist) ─────────────────────────────────

export type Severity = "ok" | "moderate" | "severe" | "uncomparable";

export interface PeerStat {
  peerKey: string;
  peerN: number;
  peerMedian90d: number | null;
  peerRatio90d: number | null;
  trajectoryRatio: number | null;
  severity: Severity;
  declining: boolean;
}

export function computePeerStats(
  engineers: ImpactEngineer[],
): Array<ImpactEngineer & PeerStat> {
  const ics = engineers.filter(
    (e) => e.isMatched && e.levelTrack === "IC" && e.levelNum != null,
  );
  const groups = new Map<string, ImpactEngineer[]>();
  for (const e of ics) {
    const key = `${e.discipline}-L${e.levelNum}`;
    const existing = groups.get(key) ?? [];
    existing.push(e);
    groups.set(key, existing);
  }

  const out: Array<ImpactEngineer & PeerStat> = [];
  for (const e of ics) {
    const key = `${e.discipline}-L${e.levelNum}`;
    const peers = (groups.get(key) ?? []).filter((p) => p.email !== e.email);
    const trajectoryRatio =
      e.impact90d > 0 ? (e.impact30d * 3) / e.impact90d : null;
    if (peers.length < 5) {
      out.push({
        ...e,
        peerKey: key,
        peerN: peers.length,
        peerMedian90d: null,
        peerRatio90d: null,
        trajectoryRatio,
        severity: "uncomparable",
        declining: false,
      });
      continue;
    }
    const peerMed = median(peers.map((p) => p.impact90d));
    const ratio = peerMed > 0 ? e.impact90d / peerMed : null;
    let severity: Severity = "ok";
    if (ratio != null && ratio < 0.5) severity = "severe";
    else if (ratio != null && ratio < 0.75) severity = "moderate";
    const declining =
      trajectoryRatio != null && trajectoryRatio < 0.6 && e.impact90d >= 50;
    out.push({
      ...e,
      peerKey: key,
      peerN: peers.length + 1,
      peerMedian90d: peerMed,
      peerRatio90d: ratio,
      trajectoryRatio,
      severity,
      declining,
    });
  }
  return out;
}
