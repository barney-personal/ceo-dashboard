import { db } from "@/lib/db";
import { githubPrs, githubEmployeeMap, modeReportData } from "@/lib/db/schema";
import { getUserProfile } from "@/lib/integrations/github";
import {
  SyncCancelledError,
  SyncDeadlineExceededError,
  throwIfSyncShouldStop,
  type SyncControl,
} from "./errors";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";

// Match GitHub's bot account naming convention: "[bot]" suffix or known CI accounts
const BOT_PATTERNS = ["[bot]", "circleci", "dependabot", "cursor", "github-actions"];

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

// ---------------------------------------------------------------------------
// LLM-assisted matching for logins that deterministic rules can't resolve
// ---------------------------------------------------------------------------

interface UnmatchedLogin {
  login: string;
  githubName: string | null;
}

interface LlmMatch {
  login: string;
  employeeName: string;
  employeeEmail: string;
}

const LLM_MATCH_TIMEOUT_MS = 60_000;

/**
 * Send unmatched GitHub logins + the employee directory to Claude and ask it
 * to match them. Returns only matches where the LLM is confident.
 */
async function llmMatchEmployees(
  unmatched: UnmatchedLogin[],
  employees: Employee[],
  opts: { signal?: AbortSignal } = {}
): Promise<LlmMatch[]> {
  if (unmatched.length === 0 || employees.length === 0) return [];

  const client = new Anthropic();

  const employeeList = employees
    .map((e) => `${e.preferred_name} <${e.employee_email}>`)
    .join("\n");

  const unmatchedList = unmatched
    .map((u) => `- login: "${u.login}"${u.githubName ? `, display name: "${u.githubName}"` : ""}`)
    .join("\n");

  const response = await client.messages.create(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are matching GitHub accounts to company employees. For each GitHub login below, determine if it matches an employee from the directory. Only include matches you are confident about.

GitHub accounts to match:
${unmatchedList}

Employee directory:
${employeeList}

Respond with a JSON array of matches. Each match should have:
- "login": the GitHub login
- "employeeName": the employee's preferred_name from the directory
- "employeeEmail": the employee's email from the directory

Only include confident matches. Common patterns:
- GitHub login may contain parts of the person's name (e.g. "andrew-muir" → "Andrew Muir")
- Login may have a "-cleo" suffix (company account)
- Display name may be a nickname or shortened version
- Login may be initials or abbreviations of the name
- Login may match the email prefix

If you cannot confidently match a login, omit it. Respond ONLY with the JSON array, no other text.`,
        },
      ],
    },
    {
      signal: AbortSignal.timeout(LLM_MATCH_TIMEOUT_MS),
    }
  );

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonStr = text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();
    const parsed = JSON.parse(jsonStr) as unknown[];

    // Validate and build a set of known employee emails for verification
    const emailSet = new Set(employees.map((e) => e.employee_email.toLowerCase()));

    return parsed
      .filter((item): item is { login: string; employeeName: string; employeeEmail: string } => {
        if (!item || typeof item !== "object") return false;
        const obj = item as Record<string, unknown>;
        return (
          typeof obj.login === "string" &&
          typeof obj.employeeName === "string" &&
          typeof obj.employeeEmail === "string" &&
          emailSet.has((obj.employeeEmail as string).toLowerCase())
        );
      });
  } catch {
    Sentry.captureMessage("Failed to parse LLM employee match response", {
      level: "warning",
      extra: { responseText: text.slice(0, 500) },
    });
    return [];
  }
}

/**
 * Fetch GitHub profiles for unmapped logins and attempt to match them
 * against employee records from Mode.
 */
export async function runGitHubEmployeeMapping(
  opts: SyncControl = {}
): Promise<{ mapped: number; bots: number; unmatched: number; skipped: number }> {
  // Get all unique GitHub logins from PRs
  const prLogins = await db
    .selectDistinct({ login: githubPrs.authorLogin })
    .from(githubPrs);

  // Get already-mapped logins — exclude low-confidence rows so they get retried
  const existingMappings = await db
    .select({
      githubLogin: githubEmployeeMap.githubLogin,
      matchConfidence: githubEmployeeMap.matchConfidence,
    })
    .from(githubEmployeeMap);

  const skipSet = new Set(
    existingMappings
      .filter((m) => m.matchConfidence !== "low")
      .map((m) => m.githubLogin)
  );
  const unmappedLogins = prLogins
    .map((r) => r.login)
    .filter((login) => !skipSet.has(login));

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

  // Collect logins that deterministic matching can't resolve for LLM pass
  const stillUnmatched: UnmatchedLogin[] = [];

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
      }).onConflictDoUpdate({
        target: githubEmployeeMap.githubLogin,
        set: { isBot: true, matchMethod: "auto" },
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
        }).onConflictDoUpdate({
          target: githubEmployeeMap.githubLogin,
          set: {
            employeeName: emailMatch.preferred_name,
            employeeEmail: emailMatch.employee_email,
            githubName,
            matchMethod: "auto",
            matchConfidence: "high",
          },
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
        }).onConflictDoUpdate({
          target: githubEmployeeMap.githubLogin,
          set: {
            employeeName: nameMatch.employee.preferred_name,
            employeeEmail: nameMatch.employee.employee_email,
            githubName,
            matchMethod: "auto",
            matchConfidence: nameMatch.confidence,
          },
        });
        mapped++;
        continue;
      }
    }

    // Deterministic matching failed — collect for LLM pass
    stillUnmatched.push({ login, githubName });
  }

  // LLM-assisted matching for remaining logins
  if (stillUnmatched.length > 0 && employees.length > 0) {
    const unmatchedLoginSet = new Set(stillUnmatched.map((u) => u.login));

    try {
      throwIfSyncShouldStop(opts, {
        cancelled: "employee matching cancelled",
        deadlineExceeded: "employee matching exceeded execution budget",
      });

      const llmMatches = await llmMatchEmployees(stillUnmatched, employees, opts);
      const llmMatchedLogins = new Set<string>();

      for (const match of llmMatches) {
        // Validate: only accept logins we actually asked about
        if (!unmatchedLoginSet.has(match.login)) continue;

        await db.insert(githubEmployeeMap).values({
          githubLogin: match.login,
          employeeName: match.employeeName,
          employeeEmail: match.employeeEmail,
          githubName: stillUnmatched.find((u) => u.login === match.login)?.githubName ?? null,
          matchMethod: "llm",
          matchConfidence: "medium",
        }).onConflictDoUpdate({
          target: githubEmployeeMap.githubLogin,
          set: {
            employeeName: match.employeeName,
            employeeEmail: match.employeeEmail,
            matchMethod: "llm",
            matchConfidence: "medium",
          },
        });
        llmMatchedLogins.add(match.login);
        mapped++;
      }

      // Store remaining as truly unmatched
      for (const entry of stillUnmatched) {
        if (llmMatchedLogins.has(entry.login)) continue;
        await db.insert(githubEmployeeMap).values({
          githubLogin: entry.login,
          githubName: entry.githubName,
          matchMethod: "auto",
          matchConfidence: "low",
        }).onConflictDoUpdate({
          target: githubEmployeeMap.githubLogin,
          set: {
            githubName: entry.githubName,
            matchMethod: "auto",
            matchConfidence: "low",
          },
        });
        unmatched++;
      }
    } catch (error) {
      if (
        error instanceof SyncCancelledError ||
        error instanceof SyncDeadlineExceededError
      ) {
        throw error;
      }
      // LLM failure is non-fatal — store all as unmatched
      Sentry.captureException(error, {
        tags: { integration: "github" },
        extra: { phase: "llm-employee-matching", unmatchedCount: stillUnmatched.length },
      });
      for (const entry of stillUnmatched) {
        await db.insert(githubEmployeeMap).values({
          githubLogin: entry.login,
          githubName: entry.githubName,
          matchMethod: "auto",
          matchConfidence: "low",
        }).onConflictDoUpdate({
          target: githubEmployeeMap.githubLogin,
          set: {
            githubName: entry.githubName,
            matchMethod: "auto",
            matchConfidence: "low",
          },
        });
        unmatched++;
      }
    }
  } else if (stillUnmatched.length > 0) {
    // No employee directory available — store as low-confidence for retry
    for (const entry of stillUnmatched) {
      await db.insert(githubEmployeeMap).values({
        githubLogin: entry.login,
        githubName: entry.githubName,
        matchMethod: "auto",
        matchConfidence: "low",
      }).onConflictDoUpdate({
        target: githubEmployeeMap.githubLogin,
        set: {
          githubName: entry.githubName,
          matchMethod: "auto",
          matchConfidence: "low",
        },
      });
      unmatched++;
    }
  }

  return { mapped, bots, unmatched, skipped };
}
