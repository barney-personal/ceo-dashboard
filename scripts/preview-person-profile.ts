import { getPersonProfile } from "@/lib/data/person-profile";

async function main() {
  const slug = process.argv[2] ?? "barney";
  const p = await getPersonProfile(slug);
  if (!p) {
    console.log(`No profile for slug: ${slug}`);
    process.exit(0);
  }
  const i = p.identity;
  console.log(`${i.name} (${i.email})`);
  console.log(
    `  ${i.jobTitle ?? "—"} · ${i.pillar ?? "—"} · ${i.squad ?? "—"} · manager: ${i.manager ?? "—"}`,
  );
  console.log(
    `  started: ${i.startDate?.slice(0, 10) ?? "—"} · tenure: ${i.tenureMonths ?? "—"}mo · slack: ${i.slackHandle ?? "—"} · github: ${i.githubLogin ?? "—"}`,
  );

  if (p.slackEngagement) {
    const s = p.slackEngagement;
    console.log(
      `  slack: score ${s.engagementScore}/100 · ${Math.round(s.activeDayRate * 100)}% active days · ${s.messagesPosted} msgs · ${s.reactionsAdded} reactions · last seen ${s.daysSinceLastActive}d ago`,
    );
  } else {
    console.log("  slack: no engagement data");
  }

  console.log(`  OKR updates authored: ${p.okrUpdatesByThem.length}`);
  if (p.okrUpdatesByThem.length > 0) {
    for (const u of p.okrUpdatesByThem.slice(0, 3)) {
      console.log(`    - ${u.postedAt.toISOString().slice(0, 10)}  ${u.status}  ${u.objectiveName} / ${u.krName}`);
    }
  }
  console.log(`  Squad OKRs: ${p.squadOkrs.length}`);
  console.log(`  Performance cycles: ${p.performance?.reviewCycles.length ?? 0}`);
  if (p.engineering) {
    const e = p.engineering;
    console.log(
      `  Engineering: impact=${e.impactScoreTotal} · ${e.prsCount} PRs / ${e.commitsCount} commits · best rank #${e.bestRank} / avg #${e.averageRank}`,
    );
    for (const m of e.monthly) {
      console.log(
        `    ${m.month.slice(0, 7)}  impact=${String(m.impact).padStart(4)}  rank=#${String(m.rank).padStart(2)}/${m.totalEngineers}  ${m.prs} PRs`,
      );
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
