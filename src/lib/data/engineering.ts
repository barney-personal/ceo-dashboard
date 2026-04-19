import { db } from "@/lib/db";
import { withDbErrorContext } from "@/lib/db/errors";
import { githubPrs, githubCommits, githubEmployeeMap } from "@/lib/db/schema";
import { gte, sql, count, sum } from "drizzle-orm";
import { getActiveEmployees, computeTenureDays, type Person } from "./people";

export interface EngineerRanking {
  login: string;
  avatarUrl: string | null;
  prsCount: number;
  commitsCount: number;
  additions: number;
  deletions: number;
  netLines: number;
  changedFiles: number;
  repos: string[];
  employeeName: string | null;
  employeeEmail: string | null;
  isBot: boolean;
  jobTitle: string | null;
  level: string | null;
  squad: string | null;
  pillar: string | null;
  tenureMonths: number | null;
  /** Whole days between the engineer's start date and now. Null when the
   *  start date is unknown or unparseable. We intentionally do NOT return
   *  the raw start date here — it would serialise into the RSC payload
   *  visible to every authenticated user, leaking exact hire dates. */
  tenureDays: number | null;
  /** True when the engineer has no merged PRs in the analysis window. */
  silent: boolean;
  /** False when the person has no GitHub mapping in `githubEmployeeMap` —
   *  PR stats will always be zero and they're effectively invisible on
   *  GitHub-side until a mapping is set up. */
  githubMapped: boolean;
}

export const PERIOD_OPTIONS = [
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
  { label: "360 days", value: 360 },
] as const;

export type PeriodDays = (typeof PERIOD_OPTIONS)[number]["value"];

export { computeImpact } from "./engineering-metrics";

/**
 * Rank currently-employed engineers by their GitHub output over the last
 * `days` days.
 *
 * The active-headcount SSoT is the spine — we intentionally do NOT include
 * PR authors who have left the company, or who aren't in Engineering. An
 * engineer who didn't ship a PR in the window is returned with `silent: true`
 * and zeroed metrics so the caller can surface them explicitly ("N engineers
 * shipped nothing") without ranking them against active shippers.
 */
export async function getEngineeringRankings(
  days: PeriodDays = 30
): Promise<EngineerRanking[]> {
  return withDbErrorContext("load engineering rankings", async () => {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const [prRows, commitRows, ghMapRows, activePeople] = await Promise.all([
      db
        .select({
          login: githubPrs.authorLogin,
          avatarUrl: sql<string | null>`MAX(${githubPrs.authorAvatarUrl})`.as(
            "avatar_url"
          ),
          prsCount: count().as("prs_count"),
          additions: sum(githubPrs.additions).mapWith(Number).as("additions"),
          deletions: sum(githubPrs.deletions).mapWith(Number).as("deletions"),
          changedFiles: sum(githubPrs.changedFiles)
            .mapWith(Number)
            .as("changed_files"),
          repos:
            sql<string[]>`ARRAY_AGG(DISTINCT ${githubPrs.repo})`.as("repos"),
        })
        .from(githubPrs)
        .where(gte(githubPrs.mergedAt, since))
        .groupBy(githubPrs.authorLogin),
      db
        .select({
          login: githubCommits.authorLogin,
          commitsCount: count().as("commits_count"),
        })
        .from(githubCommits)
        .where(gte(githubCommits.committedAt, since))
        .groupBy(githubCommits.authorLogin),
      db
        .select({
          githubLogin: githubEmployeeMap.githubLogin,
          employeeEmail: githubEmployeeMap.employeeEmail,
          isBot: githubEmployeeMap.isBot,
        })
        .from(githubEmployeeMap),
      getActiveEmployeesSafe(),
    ]);

    const prByLogin = new Map<string, (typeof prRows)[number]>();
    for (const pr of prRows) prByLogin.set(pr.login, pr);

    const commitsByLogin = new Map<string, number>();
    for (const c of commitRows) {
      commitsByLogin.set(c.login, Number(c.commitsCount) || 0);
    }

    const ghByEmail = new Map<
      string,
      { githubLogin: string; isBot: boolean }
    >();
    for (const m of ghMapRows) {
      if (m.isBot || !m.employeeEmail) continue;
      ghByEmail.set(m.employeeEmail.toLowerCase(), {
        githubLogin: m.githubLogin,
        isBot: m.isBot ?? false,
      });
    }

    const rankings: EngineerRanking[] = [];

    for (const person of activePeople) {
      // Only engineers — `function` is the normalized SSoT value, preserved
      // verbatim for anything already spelt "Engineering".
      if (person.function !== "Engineering") continue;
      if (!person.email) continue;

      const gh = ghByEmail.get(person.email.toLowerCase());
      const pr = gh ? prByLogin.get(gh.githubLogin) : undefined;
      const commitsCount = gh
        ? (commitsByLogin.get(gh.githubLogin) ?? 0)
        : 0;

      // Use the shared helper so malformed / empty start dates go through
      // one NaN-safe code path instead of propagating NaN into tenureDays.
      const tenureDays = person.startDate
        ? computeTenureDays(person.startDate)
        : null;

      const prsCount = pr?.prsCount ?? 0;
      const additions = pr?.additions ?? 0;
      const deletions = pr?.deletions ?? 0;

      rankings.push({
        login: gh?.githubLogin ?? person.email,
        avatarUrl: pr?.avatarUrl ?? null,
        prsCount,
        commitsCount,
        additions,
        deletions,
        netLines: additions - deletions,
        changedFiles: pr?.changedFiles ?? 0,
        repos: Array.isArray(pr?.repos) ? pr.repos : [],
        employeeName: person.name,
        employeeEmail: person.email,
        isBot: false,
        jobTitle: person.jobTitle || null,
        level: person.level || null,
        squad: person.squad || null,
        pillar: person.pillar || null,
        tenureMonths: person.tenureMonths,
        tenureDays,
        silent: prsCount === 0,
        githubMapped: gh != null,
      });
    }

    // Sort by PRs desc so callers that don't re-sort get a sensible default.
    rankings.sort((a, b) => b.prsCount - a.prsCount);
    return rankings;
  });
}

async function getActiveEmployeesSafe(): Promise<Person[]> {
  try {
    const { employees, unassigned } = await getActiveEmployees();
    return [...employees, ...unassigned];
  } catch {
    // Mode data unavailable — return empty so the caller gets an empty
    // ranking rather than a crash. The page shows its usual empty state.
    return [];
  }
}
