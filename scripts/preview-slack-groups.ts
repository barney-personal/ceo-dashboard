import { aggregateMembers, getLatestSlackMembersSnapshot } from "@/lib/data/slack-members";

async function main() {
  const snap = await getLatestSlackMembersSnapshot();
  if (!snap) {
    console.log("No snapshot.");
    process.exit(0);
  }
  const pillars = aggregateMembers(snap.rows, "pillar").sort(
    (a, b) => b.avgEngagement - a.avgEngagement,
  );
  console.log("Pillars:");
  for (const p of pillars) {
    console.log(
      `  ${String(p.avgEngagement).padStart(3)} avg · ${String(p.medianEngagement).padStart(3)} med · ${String(p.memberCount).padStart(3)} members · ${String(Math.round(p.activeShare * 100)).padStart(3)}% active · ${p.totalMessages.toLocaleString().padStart(9)} msgs  ${p.key}`,
    );
  }

  const squads = aggregateMembers(snap.rows, "squad");
  console.log(`\nTop 5 squads by engagement:`);
  for (const s of [...squads].sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 5)) {
    console.log(
      `  ${String(s.avgEngagement).padStart(3)}/100  ${s.memberCount} members  ${s.key} (${s.pillar ?? "—"})`,
    );
  }
  console.log(`\nBottom 5 squads (by engagement):`);
  for (const s of [...squads].sort((a, b) => a.avgEngagement - b.avgEngagement).slice(0, 5)) {
    console.log(
      `  ${String(s.avgEngagement).padStart(3)}/100  ${s.memberCount} members  ${s.key} (${s.pillar ?? "—"})`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
