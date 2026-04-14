import { db } from "@/lib/db";
import { githubPrMetrics, githubEmployeeMap, modeReportData } from "@/lib/db/schema";
import { getUserProfile } from "@/lib/integrations/github";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  throwIfSyncShouldStop,
  type SyncControl,
} from "./errors";
import { eq } from "drizzle-orm";

// Match GitHub's bot account naming convention: "[bot]" suffix or known CI accounts
const BOT_PATTERNS = ["[bot]", "circleci"];

interface Employee {
  preferred_name: string;
  employee_email: string;
  function_name: string;
}

function isLikelyBot(login: string): boolean {
  const lower = login.toLowerCase();
  return BOT_PATTERNS.some((p) => lower.endsWith(p) || lower === p);
}

/**
 * Normalize a name for fuzzy matching:
 * lowercase, strip accents, remove hyphens/apostrophes, collapse whitespace.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[-''.]/g, " ") // replace hyphens/apostrophes with spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to match a GitHub display name to an employee.
 * Returns the best match and confidence level.
 */
function findEmployeeMatch(
  githubName: string,
  employees: Employee[]
): { employee: Employee; confidence: "high" | "medium" } | null {
  const normalized = normalizeName(githubName);
  const parts = normalized.split(" ");

  // High confidence: exact full name match
  for (const emp of employees) {
    if (normalizeName(emp.preferred_name) === normalized) {
      return { employee: emp, confidence: "high" };
    }
  }

  // High confidence: first + last name match (handles middle names)
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    for (const emp of employees) {
      const empParts = normalizeName(emp.preferred_name).split(" ");
      if (empParts.length >= 2) {
        const empFirst = empParts[0];
        const empLast = empParts[empParts.length - 1];
        if (first === empFirst && last === empLast) {
          return { employee: emp, confidence: "high" };
        }
      }
    }
  }

  // Medium confidence: email prefix matches login
  // e.g. login "rob" matches "rob.smith@meetcleo.com"
  if (parts.length === 1) {
    for (const emp of employees) {
      const emailPrefix = emp.employee_email.split("@")[0].toLowerCase();
      const emailParts = emailPrefix.split(".");
      if (emailParts[0] === normalized || emailPrefix === normalized) {
        return { employee: emp, confidence: "medium" };
      }
    }
  }

  return null;
}

/**
 * Fetch GitHub profiles for unmapped logins and attempt to match them
 * against employee records from Mode.
 */
export async function runGitHubEmployeeMapping(
  opts: SyncControl = {}
): Promise<{ mapped: number; bots: number; unmatched: number; skipped: number }> {
  // Get all unique GitHub logins from PR metrics
  const prLogins = await db
    .selectDistinct({ login: githubPrMetrics.login })
    .from(githubPrMetrics);

  // Get already-mapped logins
  const existingMappings = await db
    .select({ githubLogin: githubEmployeeMap.githubLogin })
    .from(githubEmployeeMap);

  const mappedSet = new Set(existingMappings.map((m) => m.githubLogin));
  const unmappedLogins = prLogins
    .map((r) => r.login)
    .filter((login) => !mappedSet.has(login));

  if (unmappedLogins.length === 0) {
    return { mapped: 0, bots: 0, unmatched: 0, skipped: 0 };
  }

  // Load employee data from Mode
  const empRows = await db
    .select({ data: modeReportData.data })
    .from(modeReportData)
    .where(eq(modeReportData.queryName, "current_employees"))
    .limit(1);

  const employees: Employee[] =
    empRows.length > 0 ? (empRows[0].data as Employee[]) : [];

  let mapped = 0;
  let bots = 0;
  let unmatched = 0;
  let skipped = 0;

  for (const login of unmappedLogins) {
    throwIfSyncShouldStop(opts, {
      cancelled: "employee matching cancelled",
      deadlineExceeded: "employee matching exceeded execution budget",
    });

    // Check if it's a bot
    if (isLikelyBot(login)) {
      await db.insert(githubEmployeeMap).values({
        githubLogin: login,
        matchMethod: "auto",
        isBot: true,
      });
      bots++;
      continue;
    }

    // Fetch GitHub profile for display name
    let githubName: string | null = null;
    let githubEmail: string | null = null;
    try {
      const profile = await getUserProfile(login, opts);
      githubName = profile.name;
      githubEmail = profile.email;
    } catch (error) {
      // Re-throw cancellation/deadline errors
      if (
        error instanceof SyncCancelledError ||
        error instanceof SyncDeadlineExceededError
      ) {
        throw error;
      }
      // Transient failure — skip this login so it retries next sync
      skipped++;
      continue;
    }

    // Try to match by email first (highest confidence)
    if (githubEmail && employees.length > 0) {
      const emailMatch = employees.find(
        (e) => e.employee_email.toLowerCase() === githubEmail!.toLowerCase()
      );
      if (emailMatch) {
        await db.insert(githubEmployeeMap).values({
          githubLogin: login,
          employeeName: emailMatch.preferred_name,
          employeeEmail: emailMatch.employee_email,
          githubName,
          matchMethod: "auto",
          matchConfidence: "high",
        });
        mapped++;
        continue;
      }
    }

    // Try name-based matching
    if (githubName && employees.length > 0) {
      const nameMatch = findEmployeeMatch(githubName, employees);
      if (nameMatch) {
        await db.insert(githubEmployeeMap).values({
          githubLogin: login,
          employeeName: nameMatch.employee.preferred_name,
          employeeEmail: nameMatch.employee.employee_email,
          githubName,
          matchMethod: "auto",
          matchConfidence: nameMatch.confidence,
        });
        mapped++;
        continue;
      }
    }

    // No match found — store with GitHub name for manual review
    await db.insert(githubEmployeeMap).values({
      githubLogin: login,
      githubName,
      matchMethod: "auto",
      matchConfidence: "low",
    });
    unmatched++;
  }

  return { mapped, bots, unmatched, skipped };
}
