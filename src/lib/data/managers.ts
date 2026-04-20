import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modeReportData, modeReports } from "@/lib/db/schema";

export interface ManagerReport {
  email: string;
  name: string;
  jobTitle: string | null;
  function: string | null;
  pillar: string | null;
  squad: string | null;
  startDate: string | null;
  level: string | null;
}

export interface ManagerInfo {
  email: string;
  name: string;
  jobTitle: string | null;
  directReports: ManagerReport[];
}

/**
 * Pull the most recent Headcount SSoT snapshot. Cached per request so repeated
 * role checks within the same render don't re-query Mode data.
 */
const loadActiveEmployees = cache(async () => {
  const [ssotRow] = await db
    .select({ data: modeReportData.data })
    .from(modeReportData)
    .innerJoin(modeReports, eq(modeReports.id, modeReportData.reportId))
    .where(
      and(
        eq(modeReports.name, "Headcount SSoT Dashboard"),
        eq(modeReports.section, "people"),
        eq(modeReportData.queryName, "headcount"),
      ),
    )
    .orderBy(desc(modeReportData.syncedAt))
    .limit(1);

  const rows = (ssotRow?.data ?? []) as Array<Record<string, unknown>>;
  const active = rows.filter(
    (r) =>
      r.email &&
      !r.termination_date &&
      String(r.email).includes("@"),
  );
  return active;
});

/** Count of direct reports for each manager_email (active reports only). */
const loadReportCountsByManagerEmail = cache(async () => {
  const active = await loadActiveEmployees();
  const counts = new Map<string, number>();
  for (const r of active) {
    const mgr = String(r.manager_email ?? "").toLowerCase().trim();
    if (!mgr) continue;
    counts.set(mgr, (counts.get(mgr) ?? 0) + 1);
  }
  return counts;
});

/** Minimum direct-reports count to qualify as a "manager" for access purposes. */
export const MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE = 2;

/**
 * Does this email run a team (≥ MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE active
 * direct reports)? Returns false for unknown emails.
 */
export async function isManagerByEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const counts = await loadReportCountsByManagerEmail();
  const n = counts.get(email.toLowerCase()) ?? 0;
  return n >= MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE;
}

/**
 * Does ANY of these emails run a team? Use when the identity provider might
 * expose multiple addresses (primary + aliases) and only one matches SSoT.
 */
export async function isManagerByAnyEmail(
  emails: Array<string | null | undefined>,
): Promise<boolean> {
  const counts = await loadReportCountsByManagerEmail();
  for (const e of emails) {
    if (!e) continue;
    const n = counts.get(e.toLowerCase()) ?? 0;
    if (n >= MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE) return true;
  }
  return false;
}

/**
 * Return the SSoT-matching email for a Clerk user given all their addresses.
 * Prefers the first email that appears as an employee in the SSoT so that
 * downstream "whose team are you viewing" queries work regardless of which
 * address Clerk flagged as primary. Falls back to the first non-empty
 * address if nothing matches.
 */
export async function resolveViewerEmail(
  emails: Array<string | null | undefined>,
): Promise<string | null> {
  const nonEmpty = emails
    .map((e) => (e ? e.toLowerCase().trim() : ""))
    .filter((e) => e.length > 0);
  if (nonEmpty.length === 0) return null;
  const active = await loadActiveEmployees();
  const activeEmails = new Set(
    active.map((r) => String(r.email ?? "").toLowerCase()),
  );
  for (const e of nonEmpty) {
    if (activeEmails.has(e)) return e;
  }
  return nonEmpty[0] ?? null;
}

function rowToReport(r: Record<string, unknown>): ManagerReport {
  return {
    email: String(r.email).toLowerCase(),
    name: (r.preferred_name as string) ?? (r.rp_full_name as string) ?? String(r.email),
    jobTitle: (r.job_title as string) ?? null,
    function: (r.hb_function as string) ?? null,
    // SSoT's `hb_squad` is typically the pillar-level group; leave finer
    // squad to the Current FTEs join in the team-performance loader.
    pillar: (r.hb_squad as string) ?? null,
    squad: null,
    startDate: (r.start_date as string) ?? null,
    level: (r.hb_level as string) ?? null,
  };
}

/** Direct reports for a given manager email. Empty array if none or unknown. */
export async function getDirectReports(
  managerEmail: string | null | undefined,
): Promise<ManagerReport[]> {
  if (!managerEmail) return [];
  const target = managerEmail.toLowerCase();
  const active = await loadActiveEmployees();
  return active
    .filter((r) => String(r.manager_email ?? "").toLowerCase() === target)
    .map(rowToReport)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface EmployeeSummary {
  email: string;
  slug: string;
  name: string;
  jobTitle: string | null;
  function: string | null;
}

/**
 * Resolve a batch of employee emails against the Headcount SSoT snapshot and
 * return a map keyed by lowercased email → summary. Unknown emails are omitted.
 * Uses the cached active-employees load so repeated lookups in the same render
 * don't re-query Mode data.
 */
export async function getEmployeeSummariesByEmail(
  emails: Array<string | null | undefined>,
): Promise<Map<string, EmployeeSummary>> {
  const wanted = new Set(
    emails
      .map((e) => (e ? e.toLowerCase().trim() : ""))
      .filter((e) => e.length > 0),
  );
  if (wanted.size === 0) return new Map();

  const active = await loadActiveEmployees();
  const out = new Map<string, EmployeeSummary>();
  for (const r of active) {
    const email = String(r.email ?? "").toLowerCase();
    if (!wanted.has(email)) continue;
    out.set(email, {
      email,
      slug: email.split("@")[0] ?? email,
      name:
        (r.preferred_name as string) ??
        (r.rp_full_name as string) ??
        email,
      jobTitle: (r.job_title as string) ?? null,
      function: (r.hb_function as string) ?? null,
    });
  }
  return out;
}

/** All managers (>= MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE reports), for picker UIs. */
export async function getAllManagers(): Promise<ManagerInfo[]> {
  const [active, counts] = await Promise.all([
    loadActiveEmployees(),
    loadReportCountsByManagerEmail(),
  ]);
  const byEmail = new Map<string, Record<string, unknown>>();
  for (const r of active) {
    const email = String(r.email ?? "").toLowerCase();
    if (email) byEmail.set(email, r);
  }
  const managers: ManagerInfo[] = [];
  for (const [mgrEmail, n] of counts) {
    if (n < MIN_DIRECT_REPORTS_FOR_MANAGER_ROLE) continue;
    const row = byEmail.get(mgrEmail);
    if (!row) continue; // manager is no longer active — dangling link
    const reports = active
      .filter((r) => String(r.manager_email ?? "").toLowerCase() === mgrEmail)
      .map(rowToReport)
      .sort((a, b) => a.name.localeCompare(b.name));
    managers.push({
      email: mgrEmail,
      name: (row.preferred_name as string) ?? mgrEmail,
      jobTitle: (row.job_title as string) ?? null,
      directReports: reports,
    });
  }
  return managers.sort((a, b) => a.name.localeCompare(b.name));
}
