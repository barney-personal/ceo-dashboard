/**
 * End-to-end test of the managers + team-performance loaders.
 * Usage: doppler run -- npx tsx scripts/test-managers.ts [manager-email]
 */
import {
  getAllManagers,
  getDirectReports,
  isManagerByEmail,
  MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE,
} from "@/lib/data/managers";
import { getTeamPerformance } from "@/lib/data/team-performance";

async function main() {
  const targetEmail = process.argv[2] ?? null;

  // Role-promotion sanity check
  console.log(
    `isManagerByEmail threshold: ≥${MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE} active direct reports\n`,
  );
  const mgrs = await getAllManagers();
  console.log(`Found ${mgrs.length} managers (≥${MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE} reports)`);
  console.log(`Top 5 by team size:`);
  for (const m of [...mgrs].sort((a, b) => b.directReports.length - a.directReports.length).slice(0, 5)) {
    console.log(`  ${String(m.directReports.length).padStart(2)} · ${m.name.padEnd(28)} ${m.jobTitle ?? ""}`);
  }

  // Promotion edge cases
  console.log(`\nPromotion checks:`);
  console.log(`  barney@meetcleo.com (CEO) → manager? ${await isManagerByEmail("barney@meetcleo.com")}`);
  console.log(`  unknown@nowhere.com → manager? ${await isManagerByEmail("unknown@nowhere.com")}`);
  if (mgrs[0]) {
    console.log(`  ${mgrs[0].email} → manager? ${await isManagerByEmail(mgrs[0].email)}`);
  }

  // Pick a manager to drill into
  const targetManager = targetEmail
    ? mgrs.find((m) => m.email === targetEmail.toLowerCase())
    : mgrs.find((m) => m.directReports.length >= 4 && m.directReports.length <= 8);
  if (!targetManager) {
    console.log(`\nNo manager found${targetEmail ? ` for ${targetEmail}` : ""}.`);
    process.exit(0);
  }
  console.log(`\n=== Team performance for ${targetManager.name} <${targetManager.email}> ===`);
  console.log(`  Role: ${targetManager.jobTitle ?? "(unknown)"}`);
  console.log(`  Direct reports: ${targetManager.directReports.length}`);

  const reports = await getDirectReports(targetManager.email);
  const team = await getTeamPerformance(targetManager.email, reports);
  console.log(
    `  Alerting reports: ${team.alertingCount} / ${team.rows.length}`,
  );
  console.log(
    `  Window: ${team.windowStart?.toISOString().slice(0, 10) ?? "—"} → ${team.windowEnd?.toISOString().slice(0, 10) ?? "—"}`,
  );

  console.log(`\nPer-report signals:`);
  for (const r of team.rows) {
    const engagement =
      r.slackEngagement !== null
        ? `eng=${String(r.slackEngagement).padStart(3)}${r.slackFunctionPercentile !== null ? `(${Math.round(r.slackFunctionPercentile * 100)}%)` : ""}`
        : "eng=—";
    const rating =
      r.latestRating !== null
        ? `rate=${r.latestRating}${r.priorRating !== null ? `(${r.priorRating}→${r.latestRating})` : ""}`
        : "rate=—";
    const impact =
      r.impactTotal !== null
        ? `imp=${r.impactTotal}${r.impactTrend !== null ? `(${r.impactTrend >= 0 ? "+" : ""}${Math.round(r.impactTrend * 100)}%)` : ""}`
        : "imp=—";
    const alerts = r.alerts.length ? `⚠ ${r.alerts.length}` : "";
    console.log(
      `  ${r.name.padEnd(26)} ${(r.function ?? "").padEnd(12)} ${engagement.padEnd(15)} ${rating.padEnd(14)} ${impact.padEnd(16)} ${alerts}`,
    );
    for (const a of r.alerts) {
      console.log(`      ⚠ ${a.message}`);
    }
  }

  console.log(
    `\nCohort sizes (for percentile context): impact=${team.cohortSizes.impactCompany}, slack-by-fn=${Object.keys(team.cohortSizes.slackByFunction).length} functions`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
