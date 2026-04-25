/**
 * Cross-judge agreement experiment.
 *
 * Picks N random matches from a tournament run that were judged by one
 * provider (default: OpenAI in our latest single-judge run), reconstructs the
 * same dossiers the original judge saw, and asks the *other* provider for a
 * verdict. Reports agreement statistics so we can decide whether the current
 * 90/10 OpenAI/Anthropic split is producing biased rankings.
 *
 *   doppler run -- npx tsx scripts/agreement-experiment.ts \
 *     --run 13 --sample 200
 */
import { sql, and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  engineerMatches,
  engineerMatchJudgments,
  engineerTournamentRuns,
} from "@/lib/db/schema";
import { buildEngineerDossier } from "@/lib/tournament/dossier";
import { judgeWithAnthropic, judgeWithOpenAi } from "@/lib/tournament/judges";
import { Semaphore } from "@/lib/tournament/semaphore";
import {
  ANTHROPIC_CONCURRENCY,
  OPENAI_CONCURRENCY,
} from "@/lib/tournament/config";
import { RUBRIC_VERSION } from "@/lib/tournament/config";

interface Args {
  runId: number | null;
  sample: number;
  source: "openai" | "anthropic";
}

function parseArgs(argv: string[]): Args {
  const args: Args = { runId: null, sample: 200, source: "openai" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run") args.runId = parseInt(argv[++i] ?? "0", 10);
    else if (arg === "--sample") args.sample = parseInt(argv[++i] ?? "200", 10);
    else if (arg === "--source-provider") {
      const v = argv[++i];
      if (v === "anthropic" || v === "openai") args.source = v;
      else throw new Error(`--source-provider must be anthropic|openai`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const runId =
    args.runId ??
    (
      await db
        .select({ id: engineerTournamentRuns.id })
        .from(engineerTournamentRuns)
        .where(eq(engineerTournamentRuns.status, "completed"))
        .orderBy(sql`${engineerTournamentRuns.id} DESC`)
        .limit(1)
    )[0]?.id;
  if (!runId) {
    console.error("No completed run found");
    process.exit(1);
  }

  const target: "openai" | "anthropic" = args.source === "openai" ? "anthropic" : "openai";
  console.log(
    `\nSampling ${args.sample} random ${args.source}-judged matches from run #${runId}; asking ${target} for the same verdict.\n`,
  );

  const candidates = await db
    .select({
      matchId: engineerMatches.id,
      engineerAEmail: engineerMatches.engineerAEmail,
      engineerBEmail: engineerMatches.engineerBEmail,
      windowStart: engineerTournamentRuns.windowStart,
      windowEnd: engineerTournamentRuns.windowEnd,
      sourceVerdict: engineerMatchJudgments.verdict,
      sourceConfidencePct: engineerMatchJudgments.confidencePct,
      sourceProvider: engineerMatchJudgments.judgeProvider,
    })
    .from(engineerMatchJudgments)
    .innerJoin(
      engineerMatches,
      eq(engineerMatches.id, engineerMatchJudgments.matchId),
    )
    .innerJoin(
      engineerTournamentRuns,
      eq(engineerTournamentRuns.id, engineerMatches.runId),
    )
    .where(
      and(
        eq(engineerMatches.runId, runId),
        eq(engineerMatchJudgments.judgeProvider, args.source),
      ),
    );

  // Random sample
  const sampled = [...candidates]
    .sort(() => Math.random() - 0.5)
    .slice(0, args.sample);
  console.log(`Selected ${sampled.length} matches (of ${candidates.length} total ${args.source}-judged)\n`);

  const anthroSem = new Semaphore(ANTHROPIC_CONCURRENCY);
  const openSem = new Semaphore(OPENAI_CONCURRENCY);

  const results: {
    matchId: number;
    sourceVerdict: string;
    targetVerdict: string;
    sourceConf: number | null;
    targetConf: number | null;
    agreed: boolean;
    error?: string;
  }[] = [];

  let done = 0;
  let totalCost = 0;
  const start = Date.now();

  await Promise.all(
    sampled.map(async (match) => {
      const [a, b] = await Promise.all([
        buildEngineerDossier(
          match.engineerAEmail,
          match.windowStart,
          match.windowEnd,
          "A",
        ),
        buildEngineerDossier(
          match.engineerBEmail,
          match.windowStart,
          match.windowEnd,
          "B",
        ),
      ]);
      if (!a || !b) {
        results.push({
          matchId: match.matchId,
          sourceVerdict: match.sourceVerdict,
          targetVerdict: "ERR_DOSSIER",
          sourceConf: match.sourceConfidencePct,
          targetConf: null,
          agreed: false,
          error: "missing dossier",
        });
        done++;
        return;
      }

      const judgeInput = {
        pairing: {
          matchId: match.matchId,
          runId: runId ?? 0,
          engineerAEmail: match.engineerAEmail,
          engineerBEmail: match.engineerBEmail,
          rubricVersion: RUBRIC_VERSION,
        },
        windowStart: match.windowStart,
        windowEnd: match.windowEnd,
        dossierA: a.rendered,
        dossierB: b.rendered,
      };

      try {
        const judgment = target === "anthropic"
          ? await anthroSem.run(() => judgeWithAnthropic(judgeInput))
          : await openSem.run(() => judgeWithOpenAi(judgeInput));
        totalCost += judgment.costUsd ?? 0;
        const agreed = judgment.verdict === match.sourceVerdict;
        results.push({
          matchId: match.matchId,
          sourceVerdict: match.sourceVerdict,
          targetVerdict: judgment.verdict,
          sourceConf: match.sourceConfidencePct,
          targetConf: judgment.confidencePct,
          agreed,
        });
      } catch (err) {
        results.push({
          matchId: match.matchId,
          sourceVerdict: match.sourceVerdict,
          targetVerdict: "ERR_JUDGE",
          sourceConf: match.sourceConfidencePct,
          targetConf: null,
          agreed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      done++;
      if (done % 10 === 0 || done === sampled.length) {
        process.stdout.write(
          `\r  ${done}/${sampled.length} done · cost $${totalCost.toFixed(2)}    `,
        );
      }
    }),
  );

  const wallSec = (Date.now() - start) / 1000;
  console.log(`\n\nCompleted in ${wallSec.toFixed(1)}s, cost $${totalCost.toFixed(3)}\n`);

  const ok = results.filter((r) => !r.error);
  const errored = results.length - ok.length;
  const agreed = ok.filter((r) => r.agreed).length;
  const disagreed = ok.filter((r) => !r.agreed).length;
  const flipAtoB = ok.filter((r) => r.sourceVerdict === "A" && r.targetVerdict === "B").length;
  const flipBtoA = ok.filter((r) => r.sourceVerdict === "B" && r.targetVerdict === "A").length;
  const sourceDraws = ok.filter((r) => r.sourceVerdict === "draw").length;
  const targetDraws = ok.filter((r) => r.targetVerdict === "draw").length;
  const drawDiff = ok.filter(
    (r) => (r.sourceVerdict === "draw") !== (r.targetVerdict === "draw"),
  ).length;

  console.log("=== Agreement summary ===");
  console.log(`  Successful comparisons: ${ok.length} (${errored} errored)`);
  console.log(`  Agreement rate: ${((agreed / ok.length) * 100).toFixed(1)}% (${agreed}/${ok.length})`);
  console.log(`  Disagreements: ${disagreed}`);
  console.log(`    A→B flips (source said A, target said B): ${flipAtoB}`);
  console.log(`    B→A flips (source said B, target said A): ${flipBtoA}`);
  console.log(`    Draw-vs-decisive disagreements: ${drawDiff}`);
  console.log(
    `  Source draw rate: ${((sourceDraws / ok.length) * 100).toFixed(1)}%; target draw rate: ${((targetDraws / ok.length) * 100).toFixed(1)}%`,
  );

  // Avg confidence on agreed vs disagreed (does the source judge "know" when it's wrong?)
  const sourceConfsAgreed = ok
    .filter((r) => r.agreed && r.sourceConf !== null)
    .map((r) => r.sourceConf!) as number[];
  const sourceConfsDisagreed = ok
    .filter((r) => !r.agreed && r.sourceConf !== null)
    .map((r) => r.sourceConf!) as number[];
  const avg = (xs: number[]) => xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(
    `  Source-judge avg confidence — agreed: ${avg(sourceConfsAgreed).toFixed(0)}%, disagreed: ${avg(sourceConfsDisagreed).toFixed(0)}%`,
  );

  console.log("\nFirst 10 disagreements:");
  for (const r of ok.filter((x) => !x.agreed).slice(0, 10)) {
    console.log(
      `  match ${r.matchId}: source ${r.sourceVerdict} (${r.sourceConf}%) → target ${r.targetVerdict} (${r.targetConf}%)`,
    );
  }
  if (errored > 0) {
    console.log(`\n${errored} errors (first 5):`);
    for (const r of results.filter((x) => x.error).slice(0, 5)) {
      console.log(`  match ${r.matchId}: ${r.error}`);
    }
  }
}

main().then(() => process.exit(0));
