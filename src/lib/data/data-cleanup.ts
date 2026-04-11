import { getReportData, rowStr, rowNum } from "./mode";
import { normalizeJobTitle, normalizeDepartment, resolveEngineerDiscipline } from "@/lib/config/people";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataIssue {
  person: string;
  email: string;
  field: string;
  currentValue: string;
  suggestedValue: string;
}

export interface DataIssueCategory {
  id: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  issues: DataIssue[];
}

export interface DataCleanupResult {
  categories: DataIssueCategory[];
  hasSourceData: boolean;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Scan raw Mode headcount data for data quality issues.
 * Compares raw field values against our normalisation rules to surface
 * what the People team should fix at source (in HiBob / Rev).
 */
export async function detectDataIssues(): Promise<DataCleanupResult> {
  const [fteData, headcountData] = await Promise.all([
    getReportData("people", "org", ["current_employees"]),
    getReportData("people", "headcount", ["headcount"]),
  ]);

  const fteQuery = fteData.find((d) => d.queryName === "current_employees");
  const headcountQuery = headcountData.find((d) => d.queryName === "headcount");

  const fteRows = fteQuery?.rows ?? [];
  const hcRows = headcountQuery?.rows ?? [];

  // Build lookups
  const hcByEmail = new Map<string, Record<string, unknown>>();
  for (const r of hcRows) {
    if (String(r.lifecycle_status).toLowerCase() !== "employed") continue;
    if (rowNum(r, "is_cleo_headcount") !== 1) continue;
    const email = rowStr(r, "email").toLowerCase();
    if (email) hcByEmail.set(email, r);
  }

  const fteByEmail = new Map<string, Record<string, unknown>>();
  for (const r of fteRows) {
    const email = rowStr(r, "employee_email").toLowerCase();
    if (email) fteByEmail.set(email, r);
  }

  const categories: DataIssueCategory[] = [];

  // 1. Unassigned people (no pillar / no squad)
  const unassigned: DataIssue[] = [];
  for (const r of fteRows) {
    const pillar = rowStr(r, "pillar_name");
    const squad = rowStr(r, "squad_name");
    if (pillar === "no pillar" || squad === "no squad") {
      const func = rowStr(r, "function_name");
      if (func === "Customer Operations") continue; // part-time champs handled separately
      unassigned.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email: rowStr(r, "employee_email"),
        field: "pillar / squad",
        currentValue: `${pillar} / ${squad}`,
        suggestedValue: "Assign a pillar and squad in Rev",
      });
    }
  }
  categories.push({
    id: "unassigned",
    title: "Missing Pillar or Squad",
    description: "These employees have \"no pillar\" or \"no squad\" in Rev. They won't appear in the team directory and their headcount is harder to attribute.",
    severity: "high",
    issues: unassigned.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 2. Job title inconsistencies (seniority in title, non-standard naming)
  const titleIssues: DataIssue[] = [];
  for (const [email, r] of hcByEmail) {
    const rawTitle = rowStr(r, "job_title");
    if (!rawTitle) continue;
    const level = rowStr(r, "hb_level");
    const specialisation = rowStr(r, "rp_specialisation");
    const normalised = resolveEngineerDiscipline(normalizeJobTitle(rawTitle), level, specialisation);
    if (rawTitle !== normalised) {
      titleIssues.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "job_title",
        currentValue: rawTitle,
        suggestedValue: normalised,
      });
    }
  }
  categories.push({
    id: "job-titles",
    title: "Non-Standard Job Titles",
    description: "Job titles should not include seniority prefixes (Senior, Junior, etc.) — the level field handles that. Variants like \"Backend Engineer\" and \"Software Engineer\" should use a single canonical name per discipline.",
    severity: "medium",
    issues: titleIssues.sort((a, b) => a.currentValue.localeCompare(b.currentValue)),
  });

  // 3. Level prefix mismatches (e.g. SE level for a known Backend Engineer)
  const levelIssues: DataIssue[] = [];
  for (const [email, r] of hcByEmail) {
    const rawTitle = rowStr(r, "job_title");
    const level = rowStr(r, "hb_level");
    const specialisation = rowStr(r, "rp_specialisation");
    if (!level || !rawTitle) continue;

    const prefix = level.replace(/\d+$/, "").toUpperCase();
    const specLower = (specialisation || "").toLowerCase();
    const titleLower = rawTitle.toLowerCase();

    // Backend engineer with non-B level
    const isBackend = titleLower.includes("backend") || specLower.includes("backend");
    if (isBackend && prefix !== "B" && prefix !== "BE") {
      levelIssues.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "hb_level",
        currentValue: level,
        suggestedValue: level.replace(/^[A-Z]+/, "B"),
      });
    }

    // Frontend engineer with non-F level
    const isFrontend = titleLower.includes("frontend") || titleLower.includes("front-end") || specLower.includes("frontend");
    if (isFrontend && prefix !== "F" && prefix !== "FE") {
      levelIssues.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "hb_level",
        currentValue: level,
        suggestedValue: level.replace(/^[A-Z]+/, "F"),
      });
    }
  }
  categories.push({
    id: "level-prefixes",
    title: "Level Prefix Mismatches",
    description: "Backend engineers should have B-prefixed levels (e.g. B3) and frontend engineers should have F-prefixed levels (e.g. F3). Many currently use the generic SE prefix.",
    severity: "low",
    issues: levelIssues.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 4. Department mismatches (Data Science should be Analytics or ML, Product mis-assignments)
  const deptIssues: DataIssue[] = [];
  for (const r of fteRows) {
    const email = rowStr(r, "employee_email").toLowerCase();
    const func = rowStr(r, "function_name");
    if (!func) continue;

    const hc = hcByEmail.get(email);
    const rawTitle = hc ? rowStr(hc, "job_title") : "";
    const level = hc ? rowStr(hc, "hb_level") : "";
    const specialisation = hc ? rowStr(hc, "rp_specialisation") : "";
    const normalizedTitle = rawTitle ? resolveEngineerDiscipline(normalizeJobTitle(rawTitle), level, specialisation) : "";
    const normalizedDept = normalizeDepartment(func, normalizedTitle);

    if (normalizedDept !== func) {
      deptIssues.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email: rowStr(r, "employee_email"),
        field: "function_name",
        currentValue: func,
        suggestedValue: normalizedDept,
      });
    }
  }
  // Also flag anyone in headcount with hb_function = "Data Science"
  for (const [email, r] of hcByEmail) {
    if (rowStr(r, "hb_function") !== "Data Science") continue;
    if (deptIssues.some((i) => i.email.toLowerCase() === email)) continue; // already flagged via FTE
    const rawTitle = rowStr(r, "job_title");
    const level = rowStr(r, "hb_level");
    const specialisation = rowStr(r, "rp_specialisation");
    const normalizedTitle = rawTitle ? resolveEngineerDiscipline(normalizeJobTitle(rawTitle), level, specialisation) : "";
    const target = normalizeDepartment("Data Science", normalizedTitle);
    deptIssues.push({
      person: rowStr(r, "preferred_name") || "Unknown",
      email,
      field: "hb_function",
      currentValue: "Data Science",
      suggestedValue: target,
    });
  }
  categories.push({
    id: "departments",
    title: "Department Misassignments",
    description: "\"Data Science\" should be split into \"Analytics\" and \"Machine Learning\". Some Product roles (analysts, designers, marketing) belong in their functional department.",
    severity: "medium",
    issues: deptIssues.sort((a, b) => a.currentValue.localeCompare(b.currentValue) || a.person.localeCompare(b.person)),
  });

  // 5. Part-time Customer Champions without clear labelling
  const champIssues: DataIssue[] = [];
  for (const r of fteRows) {
    const pillar = rowStr(r, "pillar_name");
    const squad = rowStr(r, "squad_name");
    const func = rowStr(r, "function_name");
    if ((pillar === "no pillar" || squad === "no squad") && func === "Customer Operations") {
      const empType = rowStr(r, "employment_type");
      if (!empType.toLowerCase().includes("part")) {
        champIssues.push({
          person: rowStr(r, "preferred_name") || "Unknown",
          email: rowStr(r, "employee_email"),
          field: "employment_type",
          currentValue: empType || "(empty)",
          suggestedValue: "Part-time",
        });
      }
    }
  }
  categories.push({
    id: "part-time-champs",
    title: "Part-Time Champions Not Labelled",
    description: "Customer Operations employees with no pillar/squad are treated as part-time Customer Champions. Their employment_type should explicitly say \"Part-time\" so they're correctly excluded from headcount metrics.",
    severity: "low",
    issues: champIssues.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 6. Missing job titles
  const missingTitles: DataIssue[] = [];
  for (const [email, r] of hcByEmail) {
    const rawTitle = rowStr(r, "job_title").trim();
    if (!rawTitle) {
      missingTitles.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "job_title",
        currentValue: "(empty)",
        suggestedValue: "Set job title in HiBob",
      });
    }
  }
  categories.push({
    id: "missing-titles",
    title: "Missing Job Titles",
    description: "These employees have no job title in HiBob. They show as \"Untitled\" in the org drilldown.",
    severity: "high",
    issues: missingTitles.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 7. Missing levels
  const missingLevels: DataIssue[] = [];
  for (const [email, r] of hcByEmail) {
    const level = rowStr(r, "hb_level").trim();
    if (!level) {
      missingLevels.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "hb_level",
        currentValue: "(empty)",
        suggestedValue: "Set level in HiBob (e.g. B3, F4, SE3)",
      });
    }
  }
  categories.push({
    id: "missing-levels",
    title: "Missing Levels",
    description: "These employees have no level set in HiBob. They show as \"Unspecified\" in the level distribution drilldown.",
    severity: "high",
    issues: missingLevels.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 8. Missing function / department
  const missingFunction: DataIssue[] = [];
  for (const r of fteRows) {
    const func = rowStr(r, "function_name").trim();
    if (!func) {
      missingFunction.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email: rowStr(r, "employee_email"),
        field: "function_name",
        currentValue: "(empty)",
        suggestedValue: "Assign a function/department in Rev",
      });
    }
  }
  categories.push({
    id: "missing-function",
    title: "Missing Department",
    description: "These employees have no function assigned in Rev. They appear as \"Unassigned\" in the headcount chart.",
    severity: "high",
    issues: missingFunction.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 9. Missing manager
  const missingManager: DataIssue[] = [];
  for (const [email, r] of hcByEmail) {
    const manager = rowStr(r, "manager").trim();
    if (!manager) {
      missingManager.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "manager",
        currentValue: "(empty)",
        suggestedValue: "Set reporting manager in HiBob",
      });
    }
  }
  categories.push({
    id: "missing-manager",
    title: "Missing Manager",
    description: "These employees have no reporting manager set in HiBob.",
    severity: "medium",
    issues: missingManager.sort((a, b) => a.person.localeCompare(b.person)),
  });

  // 10. Missing location
  const missingLocation: DataIssue[] = [];
  for (const [email, r] of hcByEmail) {
    const location = rowStr(r, "work_location").trim();
    if (!location) {
      missingLocation.push({
        person: rowStr(r, "preferred_name") || "Unknown",
        email,
        field: "work_location",
        currentValue: "(empty)",
        suggestedValue: "Set work location in HiBob",
      });
    }
  }
  categories.push({
    id: "missing-location",
    title: "Missing Location",
    description: "These employees have no work location in HiBob. Location data is used for office distribution views.",
    severity: "low",
    issues: missingLocation.sort((a, b) => a.person.localeCompare(b.person)),
  });

  return {
    categories: categories.filter((c) => c.issues.length > 0),
    hasSourceData: fteRows.length > 0 || hcRows.length > 0,
  };
}
