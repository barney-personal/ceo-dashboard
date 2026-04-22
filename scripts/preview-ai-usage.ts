// Preview synced AI usage data — smoke-tests the data loader end-to-end
// against the live DB.
//
// Usage: doppler run -- npx tsx scripts/preview-ai-usage.ts
import {
  aggregateLatestMonthByUser,
  getAiUsageData,
  summariseTotals,
} from "@/lib/data/ai-usage";

async function main() {
  const data = await getAiUsageData();
  console.log("rows pulled:");
  console.log("  weeklyByCategory:", data.weeklyByCategory.length);
  console.log("  weeklyByModel:   ", data.weeklyByModel.length);
  console.log("  monthlyByModel:  ", data.monthlyByModel.length);
  console.log("  monthlyByUser:   ", data.monthlyByUser.length);
  console.log("  missing queries: ", data.missing);
  console.log("  syncedAt:        ", data.syncedAt?.toISOString() ?? "n/a");

  const totals = summariseTotals(data);
  console.log("\nsummary:");
  console.log("  totalCost:       $", totals.totalCost.toFixed(2));
  console.log("  totalTokens:      ", totals.totalTokens.toLocaleString());
  console.log("  distinct users:   ", totals.totalUsers);
  console.log(
    `  latest month ${totals.latestMonthStart}: $${totals.latestMonthCost.toFixed(2)}`,
  );
  console.log(`  prior month: $${totals.priorMonthCost.toFixed(2)}`);
  console.log(
    `  latest week ${totals.latestWeekStart}: $${totals.latestWeekCost.toFixed(2)}`,
  );

  const perUser = aggregateLatestMonthByUser(data);
  const top = [...perUser.values()]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 5);
  console.log("\ntop 5 users (latest month):");
  for (const u of top) {
    console.log(
      `  ${u.userEmail.padEnd(40)} $${u.totalCost.toFixed(2).padStart(9)}  (${u.byCategory.map((c) => c.category).join(", ")})`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
