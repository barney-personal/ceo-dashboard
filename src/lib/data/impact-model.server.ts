import { getReportData, rowStr } from "./mode";
import {
  getImpactModel,
  type ImpactEngineerPrediction,
  type ImpactModel,
} from "./impact-model";
import { getDirectReports, type ManagerReport } from "./managers";
import {
  buildCoachingCard,
  type CoachingCard,
} from "./impact-model-coaching";

/**
 * Hydrate the model JSON with current preferred names by joining each
 * engineer's `email` back to the headcount SSoT. The JSON stores plain
 * lowercased emails (private repo, leadership+-gated page) so the server
 * can look up the current preferred name without needing to rehash.
 *
 * If the DB lookup fails, the JSON's own `name` field is used as the
 * fallback — the page still renders, it just won't reflect renames that
 * happened after the model was trained.
 */
export async function getImpactModelHydrated(): Promise<ImpactModel> {
  const model = getImpactModel();

  try {
    const headcount = await getReportData("people", "headcount", ["headcount"]);
    const rows = headcount.find((r) => r.queryName === "headcount")?.rows ?? [];

    const emailToName = new Map<string, string>();
    for (const r of rows) {
      const email = rowStr(r, "email").toLowerCase();
      if (!email) continue;
      const name =
        rowStr(r, "preferred_name") ||
        rowStr(r, "rp_full_name") ||
        email;
      emailToName.set(email, name);
    }

    const hydratedEngineers = model.engineers.map((e) => {
      const real = emailToName.get((e.email ?? "").toLowerCase());
      return { ...e, name: real ?? e.name };
    });

    return { ...model, engineers: hydratedEngineers };
  } catch (err) {
    console.warn("[impact-model] hydration failed, serving as-is:", err);
    return model;
  }
}

export interface TeamCoachingEntry {
  report: ManagerReport;
  engineer: ImpactEngineerPrediction;
  coaching: CoachingCard;
}

export interface TeamView {
  managerEmail: string;
  managerName: string | null;
  entries: TeamCoachingEntry[];
  reportsNotInModel: ManagerReport[];
  expectedImpact: number;
  teamMedianPredicted: number;
}

/**
 * Build a manager-scoped team view from the hydrated model + the manager's
 * current direct reports (looked up in the Headcount SSoT). Each entry bundles
 * the model's prediction for that report with a coaching card derived from
 * their SHAP contributions. Reports who aren't in the model (e.g. haven't
 * shipped ≥1 PR in the 360d window) are returned separately so the UI can
 * flag them rather than silently drop them.
 */
export async function buildTeamView(
  model: ImpactModel,
  managerEmail: string,
  managerName: string | null = null,
): Promise<TeamView | null> {
  const reports = await getDirectReports(managerEmail);
  if (reports.length === 0) return null;

  const emailToEngineer = new Map<string, ImpactEngineerPrediction>();
  for (const e of model.engineers) {
    if (e.email) emailToEngineer.set(e.email.toLowerCase(), e);
  }

  const entries: TeamCoachingEntry[] = [];
  const reportsNotInModel: ManagerReport[] = [];
  for (const report of reports) {
    const engineer = emailToEngineer.get(report.email.toLowerCase());
    if (!engineer) {
      reportsNotInModel.push(report);
      continue;
    }
    entries.push({
      report,
      engineer,
      coaching: buildCoachingCard(engineer),
    });
  }

  // Sort by predicted impact desc — "who's likely most productive" first.
  entries.sort((a, b) => b.engineer.predicted - a.engineer.predicted);

  const teamMedianPredicted = entries.length
    ? median(entries.map((e) => e.engineer.predicted))
    : 0;

  return {
    managerEmail,
    managerName,
    entries,
    reportsNotInModel,
    expectedImpact: model.shap.expected_impact,
    teamMedianPredicted,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
