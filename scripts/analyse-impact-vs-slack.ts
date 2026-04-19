/**
 * One-off analysis: is there a correlation between an engineer's GitHub impact
 * score (summed monthly) and their Slack engagement score over the same window?
 *
 * Produces both Pearson (linear) and Spearman (rank-based) coefficients, plus
 * a scatter table so we can eyeball outliers.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  githubEmployeeMap,
  githubPrs,
  slackMemberSnapshots,
} from "@/lib/db/schema";
import { getLatestSlackMembersSnapshot } from "@/lib/data/slack-members";

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function rank(vals: number[]): number[] {
  const indexed = vals.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(vals.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs: number[], ys: number[]): number {
  return pearson(rank(xs), rank(ys));
}

async function main() {
  const snap = await getLatestSlackMembersSnapshot();
  if (!snap) throw new Error("No snapshot");
  const windowStart = snap.windowStart;
  const windowEnd = snap.windowEnd;

  // Monthly impact per github author, summed to window total.
  const rows = await db.execute<{
    author_login: string;
    employee_email: string | null;
    impact: number;
    prs: number;
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
      m.author_login,
      gem.employee_email,
      SUM(ROUND(prs * LOG(2.0, 1.0 + lines::numeric / prs))::int)::int AS impact,
      SUM(m.prs)::int AS prs
    FROM monthly m
    LEFT JOIN ${githubEmployeeMap} gem ON gem.github_login = m.author_login
    GROUP BY 1, 2
  `);

  // Match to slack rows via email
  const slackByEmail = new Map<
    string,
    { name: string; engagementScore: number; activeDayRate: number; messages: number }
  >();
  for (const r of snap.rows) {
    if (!r.employeeEmail) continue;
    slackByEmail.set(r.employeeEmail, {
      name: r.employeeName ?? r.name,
      engagementScore: r.engagementScore,
      activeDayRate: r.activeDayRate,
      messages: r.messagesPosted,
    });
  }

  type Pair = {
    login: string;
    name: string;
    email: string;
    impact: number;
    prs: number;
    engagement: number;
    activeDayRate: number;
    messages: number;
  };
  const pairs: Pair[] = [];
  for (const r of rows) {
    if (!r.employee_email) continue;
    const slack = slackByEmail.get(r.employee_email);
    if (!slack || slack.engagementScore === 0) continue;
    pairs.push({
      login: r.author_login,
      email: r.employee_email,
      name: slack.name,
      impact: Number(r.impact) || 0,
      prs: Number(r.prs) || 0,
      engagement: slack.engagementScore,
      activeDayRate: slack.activeDayRate,
      messages: slack.messages,
    });
  }

  const impacts = pairs.map((p) => p.impact);
  const engagements = pairs.map((p) => p.engagement);
  const messages = pairs.map((p) => p.messages);
  const activity = pairs.map((p) => p.activeDayRate);

  console.log(`n = ${pairs.length} engineers (both github mapped + slack ranked)\n`);
  console.log(`Pearson (impact ↔ engagement): ${pearson(impacts, engagements).toFixed(3)}`);
  console.log(`Spearman (impact ↔ engagement): ${spearman(impacts, engagements).toFixed(3)}`);
  console.log(`Pearson (impact ↔ messages):   ${pearson(impacts, messages).toFixed(3)}`);
  console.log(`Spearman (impact ↔ messages):  ${spearman(impacts, messages).toFixed(3)}`);
  console.log(`Pearson (impact ↔ active%):    ${pearson(impacts, activity).toFixed(3)}`);
  console.log(`Spearman (impact ↔ active%):   ${spearman(impacts, activity).toFixed(3)}`);

  // Split into engagement quartiles — is impact meaningfully higher in the top?
  const byEngagement = [...pairs].sort((a, b) => a.engagement - b.engagement);
  const q = Math.floor(byEngagement.length / 4);
  const q1 = byEngagement.slice(0, q);
  const q2 = byEngagement.slice(q, q * 2);
  const q3 = byEngagement.slice(q * 2, q * 3);
  const q4 = byEngagement.slice(q * 3);
  const mean = (arr: Pair[]) =>
    arr.length ? arr.reduce((s, p) => s + p.impact, 0) / arr.length : 0;
  const median = (arr: Pair[]) => {
    if (arr.length === 0) return 0;
    const s = arr.map((p) => p.impact).sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
  };
  console.log(`\nImpact by engagement quartile:`);
  console.log(`  Q1 (least engaged)  n=${q1.length}  median impact=${median(q1).toFixed(0)}  mean=${mean(q1).toFixed(0)}`);
  console.log(`  Q2                  n=${q2.length}  median=${median(q2).toFixed(0)}  mean=${mean(q2).toFixed(0)}`);
  console.log(`  Q3                  n=${q3.length}  median=${median(q3).toFixed(0)}  mean=${mean(q3).toFixed(0)}`);
  console.log(`  Q4 (most engaged)   n=${q4.length}  median=${median(q4).toFixed(0)}  mean=${mean(q4).toFixed(0)}`);

  // Outliers: high impact + low engagement, and vice versa
  console.log(`\nHigh impact + low engagement (top 8 impact among engagement<50):`);
  for (const p of [...pairs]
    .filter((p) => p.engagement < 50)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8)) {
    console.log(
      `  eng=${String(p.engagement).padStart(3)}  impact=${String(p.impact).padStart(4)}  ${p.prs} PRs  ${p.name}`,
    );
  }
  console.log(`\nLow impact + high engagement (bottom 8 impact among engagement>=70):`);
  for (const p of [...pairs]
    .filter((p) => p.engagement >= 70)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 8)) {
    console.log(
      `  eng=${String(p.engagement).padStart(3)}  impact=${String(p.impact).padStart(4)}  ${p.prs} PRs  ${p.name}`,
    );
  }

  // Suppress unused-import warnings
  void and;
  void desc;
  void eq;
  void gte;
  void lte;
  void slackMemberSnapshots;
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
