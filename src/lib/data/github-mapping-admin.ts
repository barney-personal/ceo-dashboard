import "server-only";
import { db } from "@/lib/db";
import {
  githubCommits,
  githubEmployeeMap,
  githubPrs,
  slackEmployeeMap,
} from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { getActiveEmployees, type Person } from "./people";
import {
  scoreCandidatesForEmployee,
  type CandidateLogin,
  type EmployeeWithCandidates,
  type MappedEmployee,
  type UnmappedEmployee,
} from "./github-mapping-shared";

export interface MappingAdminData {
  unmappedEmployees: EmployeeWithCandidates[];
  mappedEmployees: MappedEmployee[];
  totalActive: number;
  totalMapped: number;
  /** Untagged GitHub logins still committing in the last 90 days. Surfaced
   *  on the page as a pickable list — replaces the old free-text search,
   *  which was too open-ended to be useful at this scale. */
  recentCandidatePool: CandidateLogin[];
}

const ACTIVE_WINDOW_DAYS = 90;

/**
 * Scoped to frontend / backend engineers only. Other technical roles
 * (data scientists, ML, designers, etc.) often don't have a GitHub login in
 * the synced repos, so surfacing them here adds noise to the unmapped count.
 */
function isPlausibleGithubUser(p: Person): boolean {
  if (p.function !== "Engineering") return false;
  const title = p.jobTitle?.toLowerCase() ?? "";
  return (
    title.includes("backend") ||
    title.includes("frontend") ||
    title.includes("full stack") ||
    title.includes("fullstack")
  );
}

interface CandidateAggregate {
  login: string;
  avatarUrl: string | null;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  commitCount: number;
  prCount: number;
}

// Drizzle's `min()` / `max()` aggregates over a `timestamp` column return the
// raw Postgres ISO string (no automatic Date coercion), so we ask for a
// `to_char` projection that produces a deterministic UTC ISO-8601 string we can
// hand straight to `new Date(...)` on the client.
const ISO_FORMAT = "YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"";

async function loadCandidateAggregates(): Promise<Map<string, CandidateAggregate>> {
  const [commitsAgg, prsAgg] = await Promise.all([
    db
      .select({
        login: githubCommits.authorLogin,
        avatarUrl: sql<string | null>`max(${githubCommits.authorAvatarUrl})`,
        firstCommitAt: sql<
          string | null
        >`to_char(min(${githubCommits.committedAt}) at time zone 'utc', ${ISO_FORMAT})`,
        lastCommitAt: sql<
          string | null
        >`to_char(max(${githubCommits.committedAt}) at time zone 'utc', ${ISO_FORMAT})`,
        count: sql<number>`count(*)::int`,
      })
      .from(githubCommits)
      .groupBy(githubCommits.authorLogin),
    db
      .select({
        login: githubPrs.authorLogin,
        avatarUrl: sql<string | null>`max(${githubPrs.authorAvatarUrl})`,
        firstPrAt: sql<
          string | null
        >`to_char(min(${githubPrs.mergedAt}) at time zone 'utc', ${ISO_FORMAT})`,
        lastPrAt: sql<
          string | null
        >`to_char(max(${githubPrs.mergedAt}) at time zone 'utc', ${ISO_FORMAT})`,
        count: sql<number>`count(*)::int`,
      })
      .from(githubPrs)
      .groupBy(githubPrs.authorLogin),
  ]);

  const byLogin = new Map<string, CandidateAggregate>();
  for (const row of commitsAgg) {
    byLogin.set(row.login, {
      login: row.login,
      avatarUrl: row.avatarUrl,
      firstCommitAt: row.firstCommitAt,
      lastCommitAt: row.lastCommitAt,
      commitCount: row.count,
      prCount: 0,
    });
  }
  for (const row of prsAgg) {
    const existing = byLogin.get(row.login);
    if (existing) {
      existing.prCount = row.count;
      if (!existing.avatarUrl) existing.avatarUrl = row.avatarUrl;
      if (!existing.firstCommitAt && row.firstPrAt) {
        existing.firstCommitAt = row.firstPrAt;
      }
      if (!existing.lastCommitAt && row.lastPrAt) {
        existing.lastCommitAt = row.lastPrAt;
      }
    } else {
      byLogin.set(row.login, {
        login: row.login,
        avatarUrl: row.avatarUrl,
        firstCommitAt: row.firstPrAt,
        lastCommitAt: row.lastPrAt,
        commitCount: 0,
        prCount: row.count,
      });
    }
  }
  return byLogin;
}

/**
 * Identify employees with no GitHub mapping and rank candidate logins for
 * each. Per-employee candidate lists are capped at the top 5 to keep page
 * weight reasonable; the full candidate pool is also returned so the client
 * can offer a "search all logins" fallback for the long tail.
 */
export async function getMappingAdminData(): Promise<MappingAdminData> {
  const [{ employees }, mappings, candidateAggregates, slackMappings] =
    await Promise.all([
      getActiveEmployees(),
      db.select().from(githubEmployeeMap),
      loadCandidateAggregates(),
      db
        .select({
          employeeEmail: slackEmployeeMap.employeeEmail,
          slackImageUrl: slackEmployeeMap.slackImageUrl,
        })
        .from(slackEmployeeMap),
    ]);

  const slackAvatarByEmail = new Map<string, string>();
  for (const s of slackMappings) {
    if (s.employeeEmail && s.slackImageUrl) {
      slackAvatarByEmail.set(s.employeeEmail.toLowerCase(), s.slackImageUrl);
    }
  }

  // Active employee emails already mapped (exclude bot rows / null employee_email).
  const mappedEmails = new Set<string>();
  // Mapping rows keyed by employee email — used to build the Mapped tab.
  const mappingByEmail = new Map<string, (typeof mappings)[number]>();
  // Logins whose mapping is fully resolved — exclude them from the candidate
  // pool entirely. Any login with an `employeeEmail` set has already been
  // tagged to someone, so it shouldn't be suggested again here. Bot rows are
  // also excluded.
  const lockedLogins = new Set<string>();
  for (const m of mappings) {
    if (m.isBot) {
      lockedLogins.add(m.githubLogin);
      continue;
    }
    if (m.employeeEmail) {
      const lower = m.employeeEmail.toLowerCase();
      mappedEmails.add(lower);
      mappingByEmail.set(lower, m);
      lockedLogins.add(m.githubLogin);
    }
  }

  const unmapped: UnmappedEmployee[] = (employees as Person[])
    .filter((p) => !mappedEmails.has(p.email.toLowerCase()))
    .filter(isPlausibleGithubUser)
    .map((p) => ({
      email: p.email,
      name: p.name,
      pillar: p.pillar,
      squad: p.squad,
      jobTitle: p.jobTitle,
      startDate: p.startDate,
      tenureMonths: p.tenureMonths,
      slackAvatarUrl: slackAvatarByEmail.get(p.email.toLowerCase()) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Decorate candidates with githubName from any low-confidence row we have on
  // file — the auto-matcher fetches profile names for unmatched logins, so this
  // is usually populated even when no employee was assigned.
  const githubNameByLogin = new Map<string, string>();
  for (const m of mappings) {
    if (m.githubName) githubNameByLogin.set(m.githubLogin, m.githubName);
  }

  const candidatePool: CandidateLogin[] = [...candidateAggregates.values()]
    .filter((c) => !lockedLogins.has(c.login))
    .map((c) => ({
      login: c.login,
      githubName: githubNameByLogin.get(c.login) ?? null,
      avatarUrl: c.avatarUrl,
      firstCommitAt: c.firstCommitAt,
      lastCommitAt: c.lastCommitAt,
      commitCount: c.commitCount,
      prCount: c.prCount,
    }));

  // Only surface candidates with a plausible textual match. Below 50 the
  // suggestion is more noise than signal (e.g. "andrew-muir" gets ~42 against
  // "Adam Lambert" purely from a shared "A" prefix). The full pool stays
  // reachable via the per-employee "Search all logins" fallback so weak/weird
  // matches aren't lost.
  const MIN_NAME_SIMILARITY = 50;
  const TOP_N = 5;
  const unmappedEmployees: EmployeeWithCandidates[] = unmapped.map((emp) => {
    const scored = scoreCandidatesForEmployee(emp, candidatePool);
    return {
      ...emp,
      candidates: scored
        .filter((c) => c.nameSim >= MIN_NAME_SIMILARITY)
        .slice(0, TOP_N),
    };
  });

  // Mapped tab — same FE/BE-engineer scope as the unmapped list, joined with
  // the mapping row + commit aggregates so the CEO can see which login is
  // currently tagged and remove it if wrong.
  const mappedEmployees: MappedEmployee[] = (employees as Person[])
    .filter(isPlausibleGithubUser)
    .map((p) => {
      const m = mappingByEmail.get(p.email.toLowerCase());
      if (!m || !m.employeeEmail) return null;
      const agg = candidateAggregates.get(m.githubLogin);
      return {
        email: p.email,
        name: p.name,
        pillar: p.pillar,
        squad: p.squad,
        jobTitle: p.jobTitle,
        startDate: p.startDate,
        tenureMonths: p.tenureMonths,
        login: m.githubLogin,
        githubName: m.githubName,
        avatarUrl: agg?.avatarUrl ?? null,
        matchMethod: m.matchMethod,
        matchConfidence: m.matchConfidence,
        commitCount: agg?.commitCount ?? 0,
        prCount: agg?.prCount ?? 0,
      } satisfies MappedEmployee;
    })
    .filter((row): row is MappedEmployee => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const activeCutoff =
    Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentCandidatePool = candidatePool.filter((c) => {
    if (!c.lastCommitAt) return false;
    const ts = new Date(c.lastCommitAt).getTime();
    return Number.isFinite(ts) && ts >= activeCutoff;
  });

  return {
    unmappedEmployees,
    mappedEmployees,
    totalActive: employees.length,
    totalMapped: mappedEmails.size,
    recentCandidatePool,
  };
}
