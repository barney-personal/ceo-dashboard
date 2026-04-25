import { db } from "@/lib/db";
import { githubEmployeeMap, githubPrs } from "@/lib/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Person } from "@/lib/data/people";
import {
  pickTopShips,
  type BriefingShip,
  type BriefingShipsBlock,
} from "@/lib/data/briefing-helpers";

const DEFAULT_SHIPS_WINDOW_DAYS = 14;
const MAX_TOP_SHIPS = 8;

/**
 * Collect merged PRs from the reader's squad over the trailing window.
 *
 * Only engineers with a GitHub mapping contribute — an unmapped squad member
 * can't have their authored PRs attributed. Bot accounts (isBot = true) are
 * excluded so auto-merge bots don't crowd out human ships.
 */
export async function loadRecentShipsForSquad({
  squad,
  squadMembers,
  windowDays = DEFAULT_SHIPS_WINDOW_DAYS,
}: {
  squad: string;
  squadMembers: Person[];
  windowDays?: number;
}): Promise<BriefingShipsBlock | null> {
  if (!squad || squadMembers.length === 0) return null;

  const memberEmails = squadMembers
    .map((p) => p.email.toLowerCase())
    .filter((e) => e.length > 0);
  if (memberEmails.length === 0) return null;

  const maps = await db
    .select({
      login: githubEmployeeMap.githubLogin,
      email: githubEmployeeMap.employeeEmail,
    })
    .from(githubEmployeeMap)
    .where(
      and(
        eq(githubEmployeeMap.isBot, false),
        inArray(githubEmployeeMap.employeeEmail, memberEmails),
      ),
    );

  if (maps.length === 0) return null;

  const emailByLogin = new Map<string, string>();
  for (const m of maps) {
    if (!m.email) continue;
    emailByLogin.set(m.login, m.email.toLowerCase());
  }
  if (emailByLogin.size === 0) return null;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  since.setUTCHours(0, 0, 0, 0);

  const prs = await db
    .select({
      repo: githubPrs.repo,
      prNumber: githubPrs.prNumber,
      title: githubPrs.title,
      authorLogin: githubPrs.authorLogin,
      mergedAt: githubPrs.mergedAt,
    })
    .from(githubPrs)
    .where(
      and(
        gte(githubPrs.mergedAt, since),
        inArray(githubPrs.authorLogin, Array.from(emailByLogin.keys())),
      ),
    )
    .orderBy(desc(githubPrs.mergedAt));

  if (prs.length === 0) {
    return {
      windowDays,
      squadName: squad,
      prCount: 0,
      authorCount: 0,
      top: [],
    };
  }

  const nameByEmail = new Map<string, string>();
  for (const p of squadMembers) {
    nameByEmail.set(p.email.toLowerCase(), p.name);
  }

  const ships: BriefingShip[] = prs.map((pr) => {
    const email = emailByLogin.get(pr.authorLogin) ?? "";
    return {
      repo: pr.repo,
      title: pr.title,
      authorName: nameByEmail.get(email) ?? pr.authorLogin,
      mergedAtIso: pr.mergedAt.toISOString(),
    };
  });

  const authors = new Set(ships.map((s) => s.authorName));

  return {
    windowDays,
    squadName: squad,
    prCount: ships.length,
    authorCount: authors.size,
    top: pickTopShips(ships, MAX_TOP_SHIPS),
  };
}
