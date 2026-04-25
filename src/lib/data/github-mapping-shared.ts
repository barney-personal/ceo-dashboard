/**
 * Pure ranking helpers for the GitHub-mapping admin page. Kept free of any
 * server-only imports (db, Drizzle) so the client component can re-rank
 * candidates against an arbitrary search query without forcing a server
 * round-trip.
 */

export interface UnmappedEmployee {
  email: string;
  name: string;
  pillar: string;
  squad: string;
  jobTitle: string;
  startDate: string;
  tenureMonths: number;
  /** Slack profile picture URL, fetched via users.info and stored on
   *  slack_employee_map.slack_image_url. Null if we don't have a Slack
   *  mapping for this employee or haven't fetched the avatar yet. */
  slackAvatarUrl: string | null;
}

export interface CandidateLogin {
  login: string;
  githubName: string | null;
  avatarUrl: string | null;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  commitCount: number;
  prCount: number;
}

export interface ScoredCandidate extends CandidateLogin {
  score: number;
  nameSim: number;
  tenureFlag: "compatible" | "predates_start" | "long_predates_start" | "unknown";
  reasons: string[];
}

export interface EmployeeWithCandidates extends UnmappedEmployee {
  candidates: ScoredCandidate[];
}

export interface MappedEmployee {
  email: string;
  name: string;
  pillar: string;
  squad: string;
  jobTitle: string;
  startDate: string;
  tenureMonths: number;
  login: string;
  githubName: string | null;
  avatarUrl: string | null;
  matchMethod: string;
  matchConfidence: string | null;
  commitCount: number;
  prCount: number;
}

export function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_'’.]/g, ' ')
    .replace(/\s+/g, " ")
    .trim();
}

function jaro(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(b.length, i + matchWindow + 1);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base === 0) return 0;
  const limit = Math.min(4, a.length, b.length);
  let prefix = 0;
  for (let i = 0; i < limit; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return base + prefix * 0.1 * (1 - base);
}

export function scoreNameSimilarity(
  employeeName: string,
  employeeEmail: string,
  candidate: { login: string; githubName: string | null }
): number {
  const empNorm = normaliseForMatch(employeeName);
  const empTokens = empNorm.split(" ").filter(Boolean);
  if (empTokens.length === 0) return 0;

  const targets: string[] = [normaliseForMatch(candidate.login)];
  if (candidate.githubName) targets.push(normaliseForMatch(candidate.githubName));

  let best = 0;
  for (const target of targets) {
    if (!target) continue;
    const jw = jaroWinkler(empNorm, target) * 100;
    const targetTokens = new Set(target.split(" ").filter(Boolean));
    const overlap = empTokens.filter((t) => targetTokens.has(t)).length;
    const overlapRatio = overlap / empTokens.length;
    const composite = jw * 0.6 + overlapRatio * 100 * 0.4;
    if (composite > best) best = composite;
  }

  // Email-prefix bonus: a login like "agnes" lines up with "agnes.k@meetcleo.com".
  const emailPrefix = employeeEmail.split("@")[0]?.toLowerCase() ?? "";
  if (emailPrefix) {
    const loginNorm = normaliseForMatch(candidate.login);
    const emailParts = emailPrefix.split(".");
    if (
      loginNorm === emailPrefix ||
      loginNorm === emailParts[0] ||
      loginNorm.startsWith(emailParts[0] + " ")
    ) {
      best = Math.max(best, 70);
    }
  }

  return Math.round(Math.min(100, best));
}

export function evaluateTenureCompat(
  employeeStartDate: string,
  firstCommitAt: string | null
): { multiplier: number; flag: ScoredCandidate["tenureFlag"] } {
  if (!firstCommitAt) return { multiplier: 1, flag: "unknown" };
  const startMs = new Date(employeeStartDate).getTime();
  const firstMs = new Date(firstCommitAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(firstMs)) {
    return { multiplier: 1, flag: "unknown" };
  }

  const daysBeforeStart = Math.floor((startMs - firstMs) / (24 * 60 * 60 * 1000));

  // Commits predate start by 1y+ — almost certainly a different person. Heavy
  // demotion (×0.1) keeps them visible for edge cases (rehires, contractor-then-FTE)
  // without surfacing them ahead of plausible matches.
  if (daysBeforeStart > 365) {
    return { multiplier: 0.1, flag: "long_predates_start" };
  }
  if (daysBeforeStart > 60) {
    return { multiplier: 0.4, flag: "predates_start" };
  }
  return { multiplier: 1, flag: "compatible" };
}

export function scoreCandidatesForEmployee(
  employee: Pick<UnmappedEmployee, "name" | "email" | "startDate">,
  candidates: CandidateLogin[]
): ScoredCandidate[] {
  return candidates
    .map((cand): ScoredCandidate => {
      const nameSim = scoreNameSimilarity(employee.name, employee.email, cand);
      const { multiplier, flag } = evaluateTenureCompat(
        employee.startDate,
        cand.firstCommitAt
      );
      // Activity is a tiebreaker, not a determinant — cap small (0..5) so a
      // prolific account can't outrank a textually-better match. Without this
      // cap, "alessandro / 985 commits" beats "adam lambert" just on volume.
      const activity = Math.min(5, Math.log10(cand.commitCount + 1) * 2);
      const score = Math.round((nameSim * multiplier + activity) * 10) / 10;

      const reasons: string[] = [];
      if (nameSim >= 80) reasons.push(`Strong name match (${nameSim})`);
      else if (nameSim >= 50) reasons.push(`Partial name match (${nameSim})`);
      if (flag === "long_predates_start") {
        reasons.push("First commit predates start date by 1y+");
      } else if (flag === "predates_start") {
        reasons.push("First commit predates start date by 60d+");
      } else if (flag === "compatible" && cand.firstCommitAt) {
        reasons.push("Commit history compatible with tenure");
      }
      if (cand.commitCount >= 50) reasons.push(`${cand.commitCount} commits`);

      return { ...cand, score, nameSim, tenureFlag: flag, reasons };
    })
    .sort((a, b) => b.score - a.score);
}
