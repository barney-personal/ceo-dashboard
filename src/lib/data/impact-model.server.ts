import { createHmac } from "node:crypto";
import { getReportData, rowStr } from "./mode";
import { getImpactModel, type ImpactModel } from "./impact-model";

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

    const hydratedEngineers = model.engineers.map((e) => {
      const real = hashToName.get(e.email_hash);
      // Deliberately do NOT hydrate `email` — the client component only needs
      // a stable unique id, and `email_hash` already serves that role. Keeps
      // real email addresses out of the page payload entirely.
      return { ...e, name: real ?? e.name };
    });

    return { ...model, engineers: hydratedEngineers };
  } catch (err) {
    // Fail soft: page still renders with anonymised labels if the DB lookup fails.
    console.warn("[impact-model] hydration failed, serving anonymised:", err);
    return model;
  }
}
