import { getLatestSlackMembersSnapshot } from "@/lib/data/slack-members";

async function main() {
  const snap = await getLatestSlackMembersSnapshot();
  if (!snap) {
    console.log("No snapshot.");
    process.exit(0);
  }
  const rankable = snap.rows.filter(
    (r) => !r.isGuest && !r.isDeactivated && !r.isServiceAccount,
  );
  console.log(
    `window: ${snap.windowStart.toISOString().slice(0, 10)} → ${snap.windowEnd.toISOString().slice(0, 10)}`,
  );
  console.log(`total rows: ${snap.rows.length}, rankable: ${rankable.length}`);

  // Match resolution
  const byMethod = new Map<string, number>();
  for (const r of rankable) {
    const k = r.matchMethod ?? "null";
    byMethod.set(k, (byMethod.get(k) ?? 0) + 1);
  }
  console.log("\nMatch resolution (rankable):");
  for (const [k, v] of Array.from(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }

  // Pillar distribution
  const byPillar = new Map<string, number>();
  for (const r of rankable) {
    const k = r.pillar ?? "—";
    byPillar.set(k, (byPillar.get(k) ?? 0) + 1);
  }
  console.log("\nPillar coverage:");
  for (const [k, v] of Array.from(byPillar).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }

  // Least engaged by pillar example: Engineering
  const engineers = rankable.filter(
    (r) =>
      (r.function === "Engineering" ||
        r.jobTitle?.toLowerCase().includes("engineer")) &&
      (r.tenureDays ?? 0) >= 180 &&
      r.daysSinceLastActive !== null &&
      r.daysSinceLastActive <= 30,
  );
  const bottom = [...engineers]
    .sort((a, b) => a.engagementScore - b.engagementScore)
    .slice(0, 5);
  console.log("\nLeast engaged engineers (tenured, active last 30d):");
  for (const r of bottom) {
    console.log(
      `  ${String(r.engagementScore).padStart(3)}  ${(r.employeeName ?? r.name).padEnd(24)}  ${(r.jobTitle ?? "").slice(0, 30).padEnd(30)}  ${r.pillar ?? ""}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
