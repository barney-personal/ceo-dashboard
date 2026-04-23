import { createHmac } from "node:crypto";
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

// HMAC-SHA256 with a shared secret. Using a plain SHA256 would let anyone with
// the committed JSON recover emails by hashing candidates from a company
// directory (the keyspace is small — a few hundred plausible emails). The
// key lives in Doppler (IMPACT_MODEL_HASH_KEY) and must match the key used
// by ml-impact/train.py when the model was built.
function hashEmail(email: string, key: string): string {
  return createHmac("sha256", key).update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Hydrate the static anonymised model JSON with real employee names at
 * request time by joining email_hash back to the current headcount SSoT.
 *
 * The committed JSON has "Engineer NNN" pseudonyms (so the source tree
 * never carries PII), but the page is leadership+-gated so real names
 * are safe to display in the rendered output. This function runs
 * server-side only.
 *
 * If the DB lookup fails or the hash doesn't match any current employee,
 * we fall back to the anonymised pseudonym — so a stale engineer hash
 * after someone leaves Cleo will just show "Engineer NNN" rather than
 * crash the page.
 */
export async function getImpactModelHydrated(): Promise<ImpactModel> {
  const model = getImpactModel();
  const key = process.env.IMPACT_MODEL_HASH_KEY;
  if (!key) {
    // Without the key, we can't compute matching hashes — serve anonymised.
    // This is not an error in local dev without the secret; just a degraded mode.
    console.warn("[impact-model] IMPACT_MODEL_HASH_KEY not set, serving anonymised");
    return model;
  }

  try {
    const headcount = await getReportData("people", "headcount", ["headcount"]);
    const rows = headcount.find((r) => r.queryName === "headcount")?.rows ?? [];

    const hashToName = new Map<string, string>();
    for (const r of rows) {
      const email = rowStr(r, "email").toLowerCase();
      if (!email) continue;
      const name =
        rowStr(r, "preferred_name") ||
        rowStr(r, "rp_full_name") ||
        email;
      hashToName.set(hashEmail(email, key), name);
    }

    let matches = 0;
    const hydratedEngineers = model.engineers.map((e) => {
      const real = hashToName.get(e.email_hash);
      if (real) matches++;
      // Deliberately do NOT hydrate `email` — the client component only needs
      // a stable unique id, and `email_hash` already serves that role. Keeps
      // real email addresses out of the page payload entirely.
      return { ...e, name: real ?? e.name };
    });

    // Key-rotation detection: if we had a healthy headcount feed and a
    // populated model but zero of the JSON's hashes matched, it almost
    // certainly means IMPACT_MODEL_HASH_KEY was rotated without retraining.
    // Warn loudly so on-call sees the signal (the page still renders with
    // pseudonyms — silent degradation was the original complaint).
    if (
      matches === 0 &&
      model.engineers.length > 0 &&
      hashToName.size >= 10
    ) {
      console.warn(
        `[impact-model] 0/${model.engineers.length} hash matches against ${hashToName.size} headcount emails — likely IMPACT_MODEL_HASH_KEY was rotated without regenerating impact-model.json. See CLAUDE.md.`,
      );
    }

    return { ...model, engineers: hydratedEngineers };
  } catch (err) {
    // Fail soft: page still renders with anonymised labels if the DB lookup fails.
    console.warn("[impact-model] hydration failed, serving anonymised:", err);
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
  const key = process.env.IMPACT_MODEL_HASH_KEY;
  if (!key) return null;

  const reports = await getDirectReports(managerEmail);
  if (reports.length === 0) return null;

  const hashToEngineer = new Map<string, ImpactEngineerPrediction>();
  for (const e of model.engineers) hashToEngineer.set(e.email_hash, e);

  const entries: TeamCoachingEntry[] = [];
  const reportsNotInModel: ManagerReport[] = [];
  for (const report of reports) {
    const hash = hashEmail(report.email, key);
    const engineer = hashToEngineer.get(hash);
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
