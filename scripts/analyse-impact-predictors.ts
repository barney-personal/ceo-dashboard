/**
 * One-off: what features actually predict engineering impact?
 *
 * Pulls every engineer we can match across GitHub + Slack + SSoT + perf reviews,
 * then computes univariate correlations (Pearson + Spearman) with impact score
 * for continuous features, and group-mean impact for categorical features.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubEmployeeMap, githubPrs } from "@/lib/db/schema";
import { getLatestSlackMembersSnapshot } from "@/lib/data/slack-members";
import { getPerformanceData } from "@/lib/data/performance";

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function rank(vals: number[]): number[] {
  const idx = vals.map((v, i) => ({ v, i }));
  idx.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(vals.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!.i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs: number[], ys: number[]): number {
  return pearson(rank(xs), rank(ys));
}

function classifyJobTitle(title: string | null): string {
  if (!title) return "Other";
  const t = title.toLowerCase();
  if (t.includes("staff") || t.includes("principal")) return "Staff/Principal";
  if (t.includes("machine learning") || t.includes("ml engineer") || t.includes("/ml"))
    return "ML";
  if (t.includes("backend") || t.includes("be ")) return "Backend";
  if (t.includes("front-end") || t.includes("frontend")) return "Frontend";
  if (t.includes("qa ") || t.includes("quality")) return "QA";
  if (t.includes("data")) return "Data";
  if (t.includes("tech lead") || t.includes("engineering manager") || t.includes("em "))
    return "Lead/EM";
  if (t.includes("devops") || t.includes("platform") || t.includes("sre")) return "Platform";
  return "Other SWE";
}

async function main() {
  const snap = await getLatestSlackMembersSnapshot();
  if (!snap) throw new Error("No snapshot");
  const windowStart = snap.windowStart;
  const windowEnd = snap.windowEnd;

  // Impact per author
  const impactRows = await db.execute<{
    employee_email: string | null;
    author_login: string;
    impact: number;
    prs: number;
    lines: number;
  }>(sql`
    WITH monthly AS (
      SELECT
        date_trunc('month', ${githubPrs.mergedAt})::date AS month,
        ${githubPrs.authorLogin} AS author_login,
        COUNT(*)::int AS prs,
        COALESCE(SUM(${githubPrs.additions} + ${githubPrs.deletions}), 0)::bigint AS lines
      FROM ${githubPrs}
      LEFT JOIN ${githubEmployeeMap} ON ${githubEmployeeMap.githubLogin} = ${githubPrs.authorLogin}
      WHERE ${githubPrs.mergedAt} >= ${windowStart.toISOString()}
        AND ${githubPrs.mergedAt} < ${windowEnd.toISOString()}
        AND COALESCE(${githubEmployeeMap.isBot}, false) = false
      GROUP BY 1, 2
    )
    SELECT
      gem.employee_email,
      m.author_login,
      SUM(ROUND(m.prs * LOG(2.0, 1.0 + m.lines::numeric / m.prs))::int)::int AS impact,
      SUM(m.prs)::int AS prs,
      SUM(m.lines)::bigint AS lines
    FROM monthly m
    LEFT JOIN ${githubEmployeeMap} gem ON gem.github_login = m.author_login
    GROUP BY 1, 2
  `);

  const impactByEmail = new Map<
    string,
    { impact: number; prs: number; lines: number; login: string }
  >();
  for (const r of impactRows) {
    if (!r.employee_email) continue;
    impactByEmail.set(r.employee_email, {
      impact: Number(r.impact) || 0,
      prs: Number(r.prs) || 0,
      lines: Number(r.lines) || 0,
      login: r.author_login,
    });
  }

  const perf = await getPerformanceData();
  const perfByEmail = new Map(
    perf.people.map((p) => [p.email.toLowerCase(), p]),
  );

  // Build feature set
  interface Row {
    email: string;
    name: string;
    impact: number;
    logImpact: number;
    prs: number;
    slackEngagement: number;
    activeDayRate: number;
    messages: number;
    logMessages: number;
    reactions: number;
    daysSinceLastActive: number;
    desktopShare: number;
    channelShare: number;
    msgsPerActiveDay: number;
    tenureMonths: number | null;
    level: string | null;
    pillar: string | null;
    jobTitleFamily: string;
    avgRating: number | null;
    latestRating: number | null;
    ratingsCount: number;
  }

  const rows: Row[] = [];
  for (const s of snap.rows) {
    if (!s.employeeEmail) continue;
    const impact = impactByEmail.get(s.employeeEmail);
    if (!impact) continue; // only engineers who shipped at least one PR
    const p = perfByEmail.get(s.employeeEmail);
    const ratings = (p?.ratings ?? [])
      .map((r) => r.rating)
      .filter((r): r is number => r !== null);
    const tenureMonths = s.tenureDays !== null ? s.tenureDays / 30.4375 : null;

    rows.push({
      email: s.employeeEmail,
      name: s.employeeName ?? s.name,
      impact: impact.impact,
      logImpact: Math.log10(1 + impact.impact),
      prs: impact.prs,
      slackEngagement: s.engagementScore,
      activeDayRate: s.activeDayRate,
      messages: s.messagesPosted,
      logMessages: Math.log10(1 + s.messagesPosted),
      reactions: s.reactionsAdded,
      daysSinceLastActive: s.daysSinceLastActive ?? 365,
      desktopShare: s.desktopShare ?? 0,
      channelShare: s.channelShare ?? 0,
      msgsPerActiveDay: s.msgsPerActiveDay,
      tenureMonths,
      level: p?.level ?? null,
      pillar: p?.pillar ?? s.pillar ?? null,
      jobTitleFamily: classifyJobTitle(p?.jobTitle ?? s.jobTitle),
      avgRating: ratings.length
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : null,
      latestRating: ratings.length ? ratings[ratings.length - 1]! : null,
      ratingsCount: ratings.length,
    });
  }

  console.log(`n = ${rows.length} engineers with both GitHub and Slack data`);
  console.log(`  of which ${rows.filter((r) => r.avgRating !== null).length} have performance ratings`);
  console.log(`  of which ${rows.filter((r) => r.tenureMonths !== null).length} have tenure data`);

  // Univariate correlations (Spearman is robust to outliers/non-linearity, so
  // we key on it as the primary ranking signal; Pearson shown for context).
  const continuous: Array<[string, (r: Row) => number | null]> = [
    ["Slack engagement", (r) => r.slackEngagement],
    ["Active-day rate", (r) => r.activeDayRate],
    ["Messages (raw)", (r) => r.messages],
    ["Messages (log)", (r) => r.logMessages],
    ["Msgs/active day", (r) => r.msgsPerActiveDay],
    ["Reactions", (r) => r.reactions],
    ["Desktop share", (r) => r.desktopShare],
    ["Channel share", (r) => r.channelShare],
    ["Days since active (neg)", (r) => -r.daysSinceLastActive],
    ["Tenure months", (r) => r.tenureMonths],
    ["Avg perf rating", (r) => r.avgRating],
    ["Latest perf rating", (r) => r.latestRating],
  ];

  const results: Array<{ feature: string; n: number; pearson: number; spearman: number }> = [];
  for (const [label, get] of continuous) {
    const pairs = rows
      .map((r) => ({ x: get(r), y: r.impact }))
      .filter((p): p is { x: number; y: number } => p.x !== null);
    const n = pairs.length;
    if (n < 10) continue;
    const xs = pairs.map((p) => p.x);
    const ys = pairs.map((p) => p.y);
    results.push({
      feature: label,
      n,
      pearson: pearson(xs, ys),
      spearman: spearman(xs, ys),
    });
  }
  results.sort((a, b) => Math.abs(b.spearman) - Math.abs(a.spearman));

  console.log(`\nContinuous features vs impact (sorted by |Spearman|):`);
  console.log(`  ${"feature".padEnd(26)} ${"n".padStart(4)}  pearson  spearman`);
  for (const r of results) {
    console.log(
      `  ${r.feature.padEnd(26)} ${String(r.n).padStart(4)}   ${r.pearson.toFixed(3).padStart(6)}   ${r.spearman.toFixed(3).padStart(6)}`,
    );
  }

  // Categorical features: median/mean impact per bucket
  function groupStats<K extends string | null>(
    getter: (r: Row) => K,
    label: string,
  ) {
    const buckets = new Map<string, number[]>();
    for (const r of rows) {
      const k = getter(r) ?? "(null)";
      const arr = buckets.get(k) ?? [];
      arr.push(r.impact);
      buckets.set(k, arr);
    }
    const stats = Array.from(buckets.entries())
      .filter(([, arr]) => arr.length >= 3)
      .map(([k, arr]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median =
          sorted.length % 2 === 0
            ? (sorted[mid - 1]! + sorted[mid]!) / 2
            : sorted[mid]!;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return { k, n: arr.length, median, mean };
      })
      .sort((a, b) => b.median - a.median);
    console.log(`\n${label} (n≥3):`);
    console.log(`  ${"bucket".padEnd(26)} ${"n".padStart(4)}  ${"median".padStart(6)}  mean`);
    for (const s of stats) {
      console.log(
        `  ${s.k.padEnd(26)} ${String(s.n).padStart(4)}  ${String(Math.round(s.median)).padStart(6)}  ${Math.round(s.mean)}`,
      );
    }
  }
  groupStats((r) => r.level, "Median impact by level");
  groupStats((r) => r.jobTitleFamily, "Median impact by job family");
  groupStats((r) => r.pillar, "Median impact by pillar");
  groupStats((r) => (r.latestRating !== null ? String(r.latestRating) : null), "Median impact by latest perf rating");
  groupStats((r) => (r.avgRating !== null ? (r.avgRating >= 3.5 ? "≥3.5" : r.avgRating >= 3 ? "3.0-3.4" : "<3.0") : null), "Median impact by avg perf band");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
