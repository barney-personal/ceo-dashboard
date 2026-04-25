/**
 * Local CLI for the engineer tournament.
 *
 * Examples:
 *   doppler run -- npx tsx scripts/run-engineer-tournament.ts --list-eligible
 *   doppler run -- npx tsx scripts/run-engineer-tournament.ts --matches 10 --dry-run
 *   doppler run -- npx tsx scripts/run-engineer-tournament.ts --matches 20 \
 *     --engineers alice@meetcleo.com,bob@meetcleo.com,carol@meetcleo.com
 */
import { getCodeReviewView } from "@/lib/data/code-review";
import { listEligibleEngineers } from "@/lib/tournament/dossier";
import { runTournament } from "@/lib/tournament/runner";

interface Args {
  matches: number;
  windowDays: number;
  engineers: string[] | null;
  topBottom: number | null;
  listEligible: boolean;
  dryRun: boolean;
  singleJudge: boolean;
  continueFrom: number | null;
  verbose: boolean;
  notes: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    matches: 20,
    windowDays: 90,
    engineers: null,
    topBottom: null,
    listEligible: false,
    dryRun: false,
    singleJudge: false,
    continueFrom: null,
    verbose: false,
    notes: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--matches":
        args.matches = parseInt(argv[++i] ?? "20", 10);
        break;
      case "--window-days":
        args.windowDays = parseInt(argv[++i] ?? "90", 10);
        break;
      case "--engineers":
        args.engineers = (argv[++i] ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        break;
      case "--top-bottom":
        args.topBottom = parseInt(argv[++i] ?? "10", 10);
        break;
      case "--list-eligible":
        args.listEligible = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--single-judge":
        args.singleJudge = true;
        break;
      case "--continue-from":
        args.continueFrom = parseInt(argv[++i] ?? "0", 10);
        if (!Number.isFinite(args.continueFrom) || args.continueFrom <= 0) {
          throw new Error(`--continue-from requires a valid run ID`);
        }
        break;
      case "--verbose":
      case "-v":
        args.verbose = true;
        break;
      case "--notes":
        args.notes = argv[++i] ?? null;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown arg: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Engineer tournament runner.

Usage: tsx scripts/run-engineer-tournament.ts [options]

Options:
  --matches N           Total matches to run (default 20)
  --window-days N       Window length in days (default 90)
  --engineers a,b,c     Restrict pool to comma-separated emails
  --top-bottom N        Pool = top N + bottom N from code-review final score
  --list-eligible       Print eligible engineers and exit
  --dry-run             Skip LLM calls, use mock verdicts
  --single-judge        One judge per match (Anthropic OR OpenAI, ~10/90 split)
                        instead of two — much faster, half the data per match
  --continue-from N     Warm-start from a prior run's ratings + pair counts.
                        Caps accumulate across runs so this run only schedules
                        the marginal matches needed to reach the new cap.
  --verbose, -v         Print every judgment
  --notes "..."         Free-text note saved on the run row
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const windowEnd = new Date();
  const windowStart = new Date(
    windowEnd.getTime() - args.windowDays * 86_400_000,
  );

  if (args.listEligible) {
    const eligible = await listEligibleEngineers(windowStart, windowEnd);
    console.log(
      `\n${eligible.length} eligible engineers in the last ${args.windowDays} days:\n`,
    );
    for (const e of eligible) {
      console.log(
        `  ${e.email.padEnd(40)} ${e.displayName.padEnd(28)} ${e.githubLogins.join(",").padEnd(28)} ${e.analysedPrCount} analysed PRs`,
      );
    }
    process.exit(0);
  }

  if (args.topBottom !== null) {
    const view = await getCodeReviewView({ includePrevious: false });
    const ranked = view.engineers
      .filter((e) => e.employeeEmail && !e.isBot)
      .sort((a, b) => b.finalScore - a.finalScore);
    const N = Math.max(1, args.topBottom);
    const top = ranked.slice(0, N);
    const bottom = ranked.slice(-N);
    args.engineers = [...top, ...bottom].map((e) => e.employeeEmail!.toLowerCase());
    console.log(
      `\nResolved --top-bottom ${N} → ${args.engineers.length} engineers from code-review rankings:`,
    );
    console.log("  Top:");
    for (const e of top) {
      console.log(
        `    ${e.employeeEmail} (final ${e.finalScore.toFixed(0)}, ${e.prCount} PRs)`,
      );
    }
    console.log("  Bottom:");
    for (const e of bottom) {
      console.log(
        `    ${e.employeeEmail} (final ${e.finalScore.toFixed(0)}, ${e.prCount} PRs)`,
      );
    }
  }

  console.log(
    `\nStarting tournament: matches=${args.matches}, windowDays=${args.windowDays}, dryRun=${args.dryRun}, singleJudge=${args.singleJudge}`,
  );
  if (args.engineers) {
    console.log(`Restricted pool (${args.engineers.length}):`);
    for (const e of args.engineers) console.log(`  - ${e}`);
  }

  const startTime = Date.now();
  const summary = await runTournament({
    matchTarget: args.matches,
    windowStart,
    windowEnd,
    triggeredBy: "cli",
    notes: args.notes ?? undefined,
    engineerAllowlist: args.engineers ?? undefined,
    dryRun: args.dryRun,
    singleJudge: args.singleJudge,
    continueFromRunId: args.continueFrom ?? undefined,
    onProgress: (event) => {
      if (args.verbose && event.lastVerdict) {
        console.log(
          `  [judgment ${event.judgmentsCompleted}/${args.matches * 2}] match ${event.lastVerdict.matchId} ${event.lastVerdict.provider}: ${event.lastVerdict.verdict} (cost so far: $${event.costUsdSoFar.toFixed(3)})`,
        );
      } else if (args.verbose && event.lastError) {
        console.log(
          `  [error] match ${event.lastError.matchId}: ${event.lastError.message}`,
        );
      } else if (
        event.judgmentsCompleted > 0 &&
        event.judgmentsCompleted % 5 === 0
      ) {
        process.stdout.write(
          `\r  judgments: ${event.judgmentsCompleted} ✓ / ${event.judgmentsFailed} ✗  cost: $${event.costUsdSoFar.toFixed(3)}    `,
        );
      }
    },
  });

  const wallClock = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✓ Run ${summary.runId} complete in ${wallClock}s`);
  console.log(
    `  Matches: ${summary.matchesCompleted}/${summary.matchTarget}, judgments: ${summary.judgmentsCompleted} ✓ / ${summary.judgmentsFailed} ✗`,
  );
  console.log(`  Total cost: $${summary.totalCostUsd.toFixed(3)}`);

  console.log("\nFinal standings:");
  console.log(
    "  rank | rating  | record (W-L-D) | engineer",
  );
  console.log(
    "  -----+---------+----------------+--------------------------------",
  );
  summary.finalRatings.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(4)} | ${r.rating.toFixed(0).padStart(7)} | ${`${r.wins}-${r.losses}-${r.draws}`.padEnd(14)} | ${r.engineerEmail}`,
    );
  });
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nTournament failed:", error);
  process.exit(1);
});
