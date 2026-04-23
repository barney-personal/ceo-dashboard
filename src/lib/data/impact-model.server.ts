import { createHash } from "node:crypto";
import { getReportData, rowStr } from "./mode";
import { getImpactModel, type ImpactModel } from "./impact-model";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
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

  try {
    const headcount = await getReportData("people", "headcount", ["headcount"]);
    const rows = headcount.find((r) => r.queryName === "headcount")?.rows ?? [];

    const hashToName = new Map<string, string>();
    const hashToEmail = new Map<string, string>();
    for (const r of rows) {
      const email = rowStr(r, "email").toLowerCase();
      if (!email) continue;
      const name =
        rowStr(r, "preferred_name") ||
        rowStr(r, "rp_full_name") ||
        email;
      const hash = hashEmail(email);
      hashToName.set(hash, name);
      hashToEmail.set(hash, email);
    }

    const hydratedEngineers = model.engineers.map((e) => {
      const real = hashToName.get(e.email_hash);
      const realEmail = hashToEmail.get(e.email_hash);
      return {
        ...e,
        name: real ?? e.name,
        email: realEmail ?? e.email,
      };
    });

    return { ...model, engineers: hydratedEngineers };
  } catch (err) {
    // Fail soft: page still renders with anonymised labels if the DB lookup fails.
    console.warn("[impact-model] hydration failed, serving anonymised:", err);
    return model;
  }
}
