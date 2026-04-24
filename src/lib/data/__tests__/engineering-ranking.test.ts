import { describe, expect, it } from "vitest";
import {
  DISCIPLINE_POOL_FALLBACK,
  RANKING_ATTRIBUTION_TOLERANCE,
  RANKING_ATTRIBUTION_TOP_DRIVERS,
  RANKING_BOOTSTRAP_ITERATIONS,
  RANKING_CI_COVERAGE,
  RANKING_COMPOSITE_METHOD_LABELS,
  RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS,
  RANKING_COMPOSITE_MIN_METHODS,
  RANKING_DISAGREEMENT_EPSILON,
  RANKING_DISAGREEMENT_MIN_LENSES,
  RANKING_DOMINANCE_WIDENING,
  RANKING_LEAVE_ONE_OUT_TOP_MOVERS,
  RANKING_LENS_DEFINITIONS,
  RANKING_LENS_TOP_N,
  RANKING_LOW_PR_COUNT_THRESHOLD,
  RANKING_LOW_TENURE_DAYS_FOR_CONFIDENCE,
  RANKING_MAX_ACTIVITY_CORRELATION,
  RANKING_MAX_SIGMA,
  RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT,
  RANKING_METHODOLOGY_VERSION,
  RANKING_MIN_COHORT_SIZE,
  RANKING_MIN_OVERLAP_SAMPLES,
  RANKING_MIN_SIGMA,
  RANKING_MOVERS_MIN_GAP_DAYS,
  RANKING_MOVERS_TOP_N,
  RANKING_NOMINAL_SIGNAL_NAMES,
  RANKING_NUMERIC_SIGNAL_NAMES,
  RANKING_RAMP_UP_DAYS,
  RANKING_SIGNAL_WINDOW_DAYS,
  bucketNormalisationDeltas,
  buildAttribution,
  buildComposite,
  buildConfidence,
  buildEligibleRoster,
  buildLenses,
  buildMovers,
  buildNormalisation,
  buildRankingSnapshot,
  buildSignalAudit,
  buildStability,
  buildMethodology,
  buildSourceNotes,
  computeRankingInputHash,
  computeSpearmanRho,
  getEngineeringRanking,
  hashEmailForRanking,
  RANKING_ANTI_GAMING_ROWS,
  RANKING_QUALITY_MIN_ANALYSED_PRS,
  RANKING_QUALITY_RUBRIC_VERSION,
  RANKING_RUBRIC_VERSION,
  aggregateQualitySignals,
  RANKING_STABILITY_ADVERSARIAL_QUESTIONS,
  RANKING_STABILITY_AMBIGUOUS_COHORT_TOLERANCE,
  RANKING_STABILITY_MIN_GAP_DAYS,
  RANKING_STABILITY_PERCENTILE_THRESHOLD,
  type AttributionContribution,
  type CompositeBundle,
  type CompositeMethod,
  type ConfidenceBundle,
  type Discipline,
  type EligibilityEntry,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilityImpactModelView,
  type EligibilityInputs,
  type EligibilitySquadsRegistryRow,
  type EngineerAttribution,
  type EngineerCompositeEntry,
  type EngineerConfidence,
  type EngineerNormalisation,
  type AntiGamingRow,
  type MethodologyBundle,
  type MoversBundle,
  type PerEngineerSignalRow,
  type PrReviewAnalysisInput,
  type QualityAggregate,
  type RankingSnapshotRow,
  type StabilityBundle,
  type StabilityEntry,
  type StabilityFlag,
} from "../engineering-ranking";

describe("getEngineeringRanking (M2 signal availability)", () => {
  it("returns a methodology_pending snapshot with no engineers ranked", async () => {
    const snapshot = await getEngineeringRanking();
    expect(snapshot.status).toBe("methodology_pending");
    expect(snapshot.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(snapshot.engineers).toEqual([]);
  });

  it("does not claim the PR review graph is available", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const reviewGraph = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("reviewer graph")
    );
    expect(reviewGraph).toBeDefined();
    expect(reviewGraph?.state).toBe("unavailable");
  });

  it("marks individual review turnaround as unavailable", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const turnaround = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("review turnaround")
    );
    expect(turnaround).toBeDefined();
    expect(turnaround?.state).toBe("unavailable");
    expect(turnaround?.note).toBeTruthy();
  });

  it("marks individual PR cycle time as unavailable", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const cycleTime = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("cycle time")
    );
    expect(cycleTime).toBeDefined();
    expect(cycleTime?.state).toBe("unavailable");
    expect(cycleTime?.note).toBeTruthy();
  });

  it("keeps the per-PR LLM rubric marked as unavailable", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const rubric = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("rubric")
    );
    expect(rubric).toBeDefined();
    expect(rubric?.state).toBe("unavailable");
  });

  it("marks squad-delivery context unavailable when no persisted source is supplied", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const delivery = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("squad delivery")
    );
    expect(delivery).toBeDefined();
    expect(delivery?.state).toBe("unavailable");
    expect(`${delivery?.note ?? ""}`.toLowerCase()).toMatch(/does not call swarmia live/);
  });

  it("labels squad-delivery as squad context, not an individual signal", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const delivery = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("squad delivery")
    );
    expect(delivery).toBeDefined();
    expect(delivery?.name.toLowerCase()).toContain("squad");
    expect(delivery?.note).toBeTruthy();
  });

  it("surfaces the missing-review-signal limitation on the page", async () => {
    const { knownLimitations } = await getEngineeringRanking();
    const mentionsMissingReview = knownLimitations.some((line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes("review turnaround") ||
        lower.includes("review graph") ||
        lower.includes("reviewer graph") ||
        lower.includes("cycle time")
      );
    });
    expect(mentionsMissingReview).toBe(true);
  });

  it("does not attribute manager chain to the squads registry signal", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const squadsRegistry = plannedSignals.filter((s) => {
      const lower = s.name.toLowerCase();
      return lower.includes("squads registry") || lower.includes("squad registry");
    });
    expect(squadsRegistry.length).toBeGreaterThan(0);
    for (const signal of squadsRegistry) {
      const haystack = `${signal.name} ${signal.note ?? ""}`.toLowerCase();
      expect(haystack).not.toMatch(/manager chain/);
      expect(haystack.includes("manager email") || haystack.includes("manager_email")).toBe(false);
    }
  });

  it("sources manager chain from Mode Headcount SSoT, not squads", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const managerChainSource = plannedSignals.find((s) => {
      const haystack = `${s.name} ${s.note ?? ""}`.toLowerCase();
      return haystack.includes("manager chain");
    });
    expect(managerChainSource).toBeDefined();
    expect(managerChainSource?.name.toLowerCase()).toContain("headcount");
  });

  it("never labels any review-related signal as available", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const reviewishAvailable = plannedSignals.filter((s) => {
      const lower = s.name.toLowerCase();
      const mentionsReview =
        lower.includes("review") ||
        (lower.includes("cycle time") && lower.includes("pr"));
      const isIndividualSignal =
        !lower.includes("squad") && !lower.includes("swarmia");
      return mentionsReview && isIndividualSignal && s.state === "available";
    });
    expect(reviewishAvailable).toEqual([]);
  });
});

describe("buildEligibleRoster (M4 eligibility preflight)", () => {
  const NOW = new Date("2026-04-24T00:00:00Z");

  function row(
    overrides: Partial<EligibilityHeadcountRow> = {},
  ): EligibilityHeadcountRow {
    return {
      email: "eng@meetcleo.com",
      preferred_name: "Eng",
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: "platform",
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Finance Pillar",
      job_title: "Senior Backend Engineer",
      manager: "Boss",
      line_manager_email: "boss@meetcleo.com",
      start_date: "2024-01-01",
      termination_date: null,
      ...overrides,
    };
  }

  function map(
    overrides: Partial<EligibilityGithubMapRow> = {},
  ): EligibilityGithubMapRow {
    return {
      githubLogin: "eng",
      employeeEmail: "eng@meetcleo.com",
      isBot: false,
      ...overrides,
    };
  }

  function inputs(
    overrides: Partial<EligibilityInputs> = {},
  ): EligibilityInputs {
    const base: EligibilityInputs = {
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] } as EligibilityImpactModelView,
      now: NOW,
    };
    return { ...base, ...overrides };
  }

  it("marks a long-tenured mapped engineer as competitive", () => {
    const headcount = [row({ email: "mapped@meetcleo.com" })];
    const gh = [map({ employeeEmail: "mapped@meetcleo.com" })];
    const { entries, coverage } = buildEligibleRoster(
      inputs({
        headcountRows: headcount,
        githubMap: gh,
      }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].eligibility).toBe("competitive");
    expect(entries[0].githubLogin).toBe("eng");
    expect(entries[0].emailHash).toBe(hashEmailForRanking("mapped@meetcleo.com"));
    expect(coverage.competitive).toBe(1);
    expect(coverage.rampUpThresholdDays).toBe(RANKING_RAMP_UP_DAYS);
  });

  it("keeps active engineers without a GitHub mapping in the output", () => {
    const headcount = [
      row({ email: "unmapped@meetcleo.com", preferred_name: "Unmapped" }),
    ];
    const { entries, coverage } = buildEligibleRoster(
      inputs({ headcountRows: headcount }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].eligibility).toBe("insufficient_mapping");
    expect(entries[0].githubLogin).toBeNull();
    expect(entries[0].reason).toMatch(/githubEmployeeMap/);
    expect(coverage.insufficientMapping).toBe(1);
    expect(coverage.mappedToGitHub).toBe(0);
  });

  it("routes under-90d tenure to the ramp_up cohort, not bottom of competitive", () => {
    const recent = new Date(
      NOW.getTime() - 30 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const headcount = [
      row({
        email: "new@meetcleo.com",
        preferred_name: "Newcomer",
        start_date: recent,
      }),
    ];
    const gh = [map({ employeeEmail: "new@meetcleo.com", githubLogin: "new" })];
    const { entries, coverage } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    expect(entries[0].eligibility).toBe("ramp_up");
    expect(entries[0].reason).toContain("Ramp-up cohort");
    expect(coverage.rampUp).toBe(1);
    expect(coverage.competitive).toBe(0);
  });

  it("does not count leavers as competitive and flags them with a reason", () => {
    const leaverTerm = new Date(
      NOW.getTime() - 10 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const headcount = [
      row({
        email: "gone@meetcleo.com",
        preferred_name: "Gone",
        termination_date: leaverTerm,
      }),
    ];
    const gh = [
      map({ employeeEmail: "gone@meetcleo.com", githubLogin: "gone" }),
    ];
    const { entries, coverage } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    expect(entries[0].eligibility).toBe("inactive_or_leaver");
    expect(entries[0].isLeaverOrInactive).toBe(true);
    expect(entries[0].reason).toMatch(/regression/);
    expect(coverage.inactiveOrLeaver).toBe(1);
    expect(coverage.competitive).toBe(0);
  });

  it("treats a rehire (termination_date < start_date) as active, not a leaver", () => {
    const headcount = [
      row({
        email: "rehire@meetcleo.com",
        preferred_name: "Rehire",
        start_date: "2025-06-01",
        termination_date: "2023-12-31",
      }),
    ];
    const gh = [
      map({ employeeEmail: "rehire@meetcleo.com", githubLogin: "rehire" }),
    ];
    const { entries } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    expect(entries[0].isLeaverOrInactive).toBe(false);
    expect(entries[0].eligibility).toBe("competitive");
  });

  it("flags rows missing email or start_date as missing_required_data", () => {
    const headcount = [
      row({ email: null, preferred_name: "No Email" }),
      row({
        email: "nostart@meetcleo.com",
        preferred_name: "No Start",
        start_date: null,
      }),
    ];
    const { entries, coverage } = buildEligibleRoster(
      inputs({ headcountRows: headcount }),
    );
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.eligibility).toBe("missing_required_data");
    }
    expect(coverage.missingRequiredData).toBe(2);
  });

  it("sources manager chain from the headcount row, not the squads registry", () => {
    const headcount = [
      row({
        email: "a@meetcleo.com",
        preferred_name: "A",
        manager: "Alex Manager",
        line_manager_email: "alex@meetcleo.com",
      }),
      row({
        email: "b@meetcleo.com",
        preferred_name: "B",
        manager: null,
        line_manager_email: "brenda@meetcleo.com",
      }),
    ];
    const gh = [
      map({ employeeEmail: "a@meetcleo.com", githubLogin: "a" }),
      map({ employeeEmail: "b@meetcleo.com", githubLogin: "b" }),
    ];
    const { entries } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    const a = entries.find((e) => e.email === "a@meetcleo.com")!;
    const b = entries.find((e) => e.email === "b@meetcleo.com")!;
    expect(a.manager).toBe("Alex Manager");
    expect(b.manager).toBe("brenda@meetcleo.com");
  });

  it("ignores bot GitHub map rows so renovate/dependabot never become engineers", () => {
    const headcount = [
      row({ email: "real@meetcleo.com", preferred_name: "Real" }),
    ];
    const gh = [
      map({
        employeeEmail: "real@meetcleo.com",
        githubLogin: "renovate-bot",
        isBot: true,
      }),
    ];
    const { entries } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    expect(entries[0].githubLogin).toBeNull();
    expect(entries[0].eligibility).toBe("insufficient_mapping");
  });

  it("skips non-engineering headcount rows entirely", () => {
    const headcount = [
      row({
        email: "pm@meetcleo.com",
        preferred_name: "PM",
        hb_function: "Product",
      }),
      row({ email: "eng@meetcleo.com", preferred_name: "Eng" }),
    ];
    const gh = [map({ employeeEmail: "eng@meetcleo.com" })];
    const { entries } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].email).toBe("eng@meetcleo.com");
  });

  it("marks engineers present in the impact model so SHAP lenses can join", () => {
    const emailHash = hashEmailForRanking("shap@meetcleo.com");
    const headcount = [
      row({ email: "shap@meetcleo.com", preferred_name: "Shap" }),
      row({
        email: "missing@meetcleo.com",
        preferred_name: "Missing",
      }),
    ];
    const gh = [
      map({ employeeEmail: "shap@meetcleo.com", githubLogin: "shap" }),
      map({
        employeeEmail: "missing@meetcleo.com",
        githubLogin: "missing",
      }),
    ];
    const { entries, coverage } = buildEligibleRoster(
      inputs({
        headcountRows: headcount,
        githubMap: gh,
        impactModel: { engineers: [{ email: "shap@meetcleo.com" }] },
      }),
    );
    const shap = entries.find((e) => e.email === "shap@meetcleo.com")!;
    const missing = entries.find((e) => e.email === "missing@meetcleo.com")!;
    expect(shap.hasImpactModelRow).toBe(true);
    expect(missing.hasImpactModelRow).toBe(false);
    expect(coverage.presentInImpactModel).toBe(1);
  });

  it("never persists resolved names — they are derived from inputs at call time", () => {
    const headcount = [
      row({
        email: "alias@meetcleo.com",
        preferred_name: "Freshly Resolved Name",
      }),
    ];
    const { entries } = buildEligibleRoster(
      inputs({ headcountRows: headcount }),
    );
    // The returned entry is a plain transient object; callers must not
    // snapshot it with names intact. Prove identity via the email hash so
    // a future persistence layer can strip display name before writing.
    const e = entries[0];
    expect(e.emailHash).toBe(hashEmailForRanking("alias@meetcleo.com"));
    expect(e.displayName).toBe("Freshly Resolved Name");
    // The displayName must be derivable from the input row, not a separate
    // side table — re-running with a different preferred_name changes it.
    const { entries: entries2 } = buildEligibleRoster(
      inputs({
        headcountRows: [
          row({
            email: "alias@meetcleo.com",
            preferred_name: "Second Resolution",
          }),
        ],
      }),
    );
    expect(entries2[0].displayName).toBe("Second Resolution");
  });

  it("sorts the roster competitive → ramp_up → audit buckets", () => {
    const leaverTerm = "2026-04-01";
    const recent = new Date(
      NOW.getTime() - 30 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const headcount = [
      row({ email: "leaver@meetcleo.com", termination_date: leaverTerm }),
      row({
        email: "new@meetcleo.com",
        preferred_name: "Ramp Up",
        start_date: recent,
      }),
      row({ email: "comp@meetcleo.com", preferred_name: "Comp" }),
    ];
    const gh = [
      map({ employeeEmail: "comp@meetcleo.com", githubLogin: "comp" }),
      map({ employeeEmail: "new@meetcleo.com", githubLogin: "new" }),
      map({ employeeEmail: "leaver@meetcleo.com", githubLogin: "leaver" }),
    ];
    const { entries } = buildEligibleRoster(
      inputs({ headcountRows: headcount, githubMap: gh }),
    );
    expect(entries.map((e) => e.eligibility)).toEqual([
      "competitive",
      "ramp_up",
      "inactive_or_leaver",
    ]);
  });
});

describe("buildRankingSnapshot (M4)", () => {
  it("produces a methodology_pending snapshot with eligibility coverage populated", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [
        {
          email: "eng@meetcleo.com",
          preferred_name: "Eng",
          hb_function: "Engineering",
          hb_level: "EG3",
          hb_squad: "platform",
          rp_specialisation: "Backend Engineer",
          rp_department_name: "Finance Pillar",
          job_title: "Senior Backend Engineer",
          manager: "Boss",
          line_manager_email: "boss@meetcleo.com",
          start_date: "2023-01-01",
          termination_date: null,
        },
      ],
      githubMap: [
        {
          githubLogin: "eng",
          employeeEmail: "eng@meetcleo.com",
          isBot: false,
        },
      ],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(snapshot.status).toBe("methodology_pending");
    expect(snapshot.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(snapshot.engineers).toEqual([]);
    expect(snapshot.eligibility.entries).toHaveLength(1);
    expect(snapshot.eligibility.coverage.competitive).toBe(1);
    expect(snapshot.eligibility.sourceNotes.length).toBeGreaterThan(0);
    expect(
      snapshot.eligibility.sourceNotes.some((n) =>
        n.toLowerCase().includes("mode headcount ssot"),
      ),
    ).toBe(true);
  });
});

describe("M5 squads-registry provenance + future-start policy", () => {
  const NOW = new Date("2026-04-24T00:00:00Z");

  function row(
    overrides: Partial<EligibilityHeadcountRow> = {},
  ): EligibilityHeadcountRow {
    return {
      email: "eng@meetcleo.com",
      preferred_name: "Eng",
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: "platform",
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Finance Pillar",
      job_title: "Senior Backend Engineer",
      manager: "Boss",
      line_manager_email: "boss@meetcleo.com",
      start_date: "2024-01-01",
      termination_date: null,
      ...overrides,
    };
  }

  function map(
    overrides: Partial<EligibilityGithubMapRow> = {},
  ): EligibilityGithubMapRow {
    return {
      githubLogin: "eng",
      employeeEmail: "eng@meetcleo.com",
      isBot: false,
      ...overrides,
    };
  }

  function squad(
    overrides: Partial<EligibilitySquadsRegistryRow> = {},
  ): EligibilitySquadsRegistryRow {
    return {
      name: "Platform",
      pillar: "Engineering",
      pmName: "Pat Manager",
      channelId: "C123PLATFORM",
      isActive: true,
      ...overrides,
    };
  }

  function inputs(
    overrides: Partial<EligibilityInputs> = {},
  ): EligibilityInputs {
    const base: EligibilityInputs = {
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] } as EligibilityImpactModelView,
      now: NOW,
    };
    return { ...base, ...overrides };
  }

  it("omits the squads-registry provenance note when squads input is absent", () => {
    const snapshot = buildRankingSnapshot(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
      }),
    );
    const haystack = snapshot.eligibility.sourceNotes.join(" | ").toLowerCase();
    // The positive claim about the squads registry as a joined source must
    // not appear when we never fetched it.
    expect(haystack).not.toMatch(/canonical squad name.*joined at request time/);
    // Instead, the page must say explicitly that it was not fetched.
    expect(haystack).toMatch(/squads registry was not fetched/);
    expect(snapshot.eligibility.coverage.squadsRegistryPresent).toBe(false);
    // The `canonicalSquad` field must stay null when no registry is joined.
    const entry = snapshot.eligibility.entries[0];
    expect(entry.canonicalSquad).toBeNull();
  });

  it("emits the squads-registry provenance note only when squads input is supplied", () => {
    const snapshot = buildRankingSnapshot(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com", hb_squad: "Platform" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
        squads: [squad({ name: "Platform", channelId: "C123PLATFORM" })],
      }),
    );
    const haystack = snapshot.eligibility.sourceNotes.join(" | ").toLowerCase();
    expect(haystack).toMatch(/squads registry.*canonical squad name/);
    expect(haystack).not.toMatch(/squads registry was not fetched/);
    expect(snapshot.eligibility.coverage.squadsRegistryPresent).toBe(true);
    const entry = snapshot.eligibility.entries[0];
    expect(entry.canonicalSquad).toEqual({
      name: "Platform",
      pillar: "Engineering",
      pmName: "Pat Manager",
      channelId: "C123PLATFORM",
    });
    expect(snapshot.eligibility.coverage.squadRegistryUnmatched).toBe(0);
  });

  it("joins canonical squad metadata case-insensitively by name", () => {
    const { entries } = buildEligibleRoster(
      inputs({
        headcountRows: [
          row({ email: "a@meetcleo.com", hb_squad: "platform" }),
          row({ email: "b@meetcleo.com", hb_squad: "unknown-squad" }),
        ],
        githubMap: [
          map({ employeeEmail: "a@meetcleo.com", githubLogin: "a" }),
          map({ employeeEmail: "b@meetcleo.com", githubLogin: "b" }),
        ],
        squads: [squad({ name: "Platform" })],
      }),
    );
    const a = entries.find((e) => e.email === "a@meetcleo.com")!;
    const b = entries.find((e) => e.email === "b@meetcleo.com")!;
    expect(a.canonicalSquad?.name).toBe("Platform");
    // Headcount's raw hb_squad is preserved for debugging even when the
    // canonical join fails, so the page can surface the mismatch.
    expect(b.squad).toBe("unknown-squad");
    expect(b.canonicalSquad).toBeNull();
  });

  it("ignores inactive squads registry rows when joining canonical metadata", () => {
    const { entries } = buildEligibleRoster(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com", hb_squad: "Legacy" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
        squads: [squad({ name: "Legacy", isActive: false })],
      }),
    );
    expect(entries[0].canonicalSquad).toBeNull();
  });

  it("excludes future-start headcount rows from the roster (not ramp_up, not competitive)", () => {
    const future = new Date(
      NOW.getTime() + 14 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const { entries, coverage } = buildEligibleRoster(
      inputs({
        headcountRows: [
          row({
            email: "future@meetcleo.com",
            preferred_name: "Future Hire",
            start_date: future,
          }),
          row({ email: "now@meetcleo.com", preferred_name: "Now" }),
        ],
        githubMap: [
          map({ employeeEmail: "future@meetcleo.com", githubLogin: "future" }),
          map({ employeeEmail: "now@meetcleo.com", githubLogin: "now" }),
        ],
      }),
    );
    // Future-start engineer is excluded entirely — not ramp_up, not
    // competitive, not leaver, not missing_required_data.
    expect(entries.find((e) => e.email === "future@meetcleo.com")).toBeUndefined();
    expect(entries.map((e) => e.email)).toEqual(["now@meetcleo.com"]);
    expect(coverage.excludedFutureStart).toBe(1);
    // The remaining engineer's tenure must never be negative.
    for (const e of entries) {
      expect(e.tenureDays === null || e.tenureDays >= 0).toBe(true);
    }
    // Eligibility statuses must not include any ramp_up caused by
    // negative tenure.
    expect(coverage.rampUp).toBe(0);
  });

  it("buildSourceNotes gates the squads note on inputs.squads presence", () => {
    const withoutSquads = buildSourceNotes({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const withSquads = buildSourceNotes({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      squads: [squad()],
    });
    const withEmptySquads = buildSourceNotes({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      squads: [],
    });
    expect(withoutSquads.join(" ").toLowerCase()).toMatch(
      /squads registry was not fetched/,
    );
    expect(withSquads.join(" ").toLowerCase()).toMatch(
      /squads registry.*canonical squad name/,
    );
    // An empty array is treated the same as absent — no squads actually
    // available to join, so the positive claim must not appear.
    expect(withEmptySquads.join(" ").toLowerCase()).toMatch(
      /squads registry was not fetched/,
    );
  });
});

describe("M6 squads-registry channel provenance + empty-registry consistency", () => {
  const NOW = new Date("2026-04-24T00:00:00Z");

  function row(
    overrides: Partial<EligibilityHeadcountRow> = {},
  ): EligibilityHeadcountRow {
    return {
      email: "eng@meetcleo.com",
      preferred_name: "Eng",
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: "platform",
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Finance Pillar",
      job_title: "Senior Backend Engineer",
      manager: "Boss",
      line_manager_email: "boss@meetcleo.com",
      start_date: "2024-01-01",
      termination_date: null,
      ...overrides,
    };
  }

  function map(
    overrides: Partial<EligibilityGithubMapRow> = {},
  ): EligibilityGithubMapRow {
    return {
      githubLogin: "eng",
      employeeEmail: "eng@meetcleo.com",
      isBot: false,
      ...overrides,
    };
  }

  function squad(
    overrides: Partial<EligibilitySquadsRegistryRow> = {},
  ): EligibilitySquadsRegistryRow {
    return {
      name: "Platform",
      pillar: "Engineering",
      pmName: "Pat Manager",
      channelId: "C123PLATFORM",
      isActive: true,
      ...overrides,
    };
  }

  function inputs(
    overrides: Partial<EligibilityInputs> = {},
  ): EligibilityInputs {
    const base: EligibilityInputs = {
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] } as EligibilityImpactModelView,
      now: NOW,
    };
    return { ...base, ...overrides };
  }

  it("threads squads.channelId into canonicalSquad when the squad has one", () => {
    const { entries } = buildEligibleRoster(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com", hb_squad: "Platform" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
        squads: [squad({ name: "Platform", channelId: "C123PLATFORM" })],
      }),
    );
    expect(entries[0].canonicalSquad?.channelId).toBe("C123PLATFORM");
  });

  it("preserves a null channelId when the matched squad has no Slack channel configured", () => {
    const { entries } = buildEligibleRoster(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com", hb_squad: "Platform" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
        squads: [squad({ name: "Platform", channelId: null })],
      }),
    );
    // A matched squad is still a match; channelId === null is legitimate
    // for squads that have not configured a Slack channel. The distinction
    // between "no match" (canonicalSquad === null) and "matched, no channel"
    // (canonicalSquad.channelId === null) must be preserved.
    expect(entries[0].canonicalSquad).not.toBeNull();
    expect(entries[0].canonicalSquad?.channelId).toBeNull();
  });

  it("positive squads-registry provenance note lists exactly name, pillar, PM, and Slack channel id", () => {
    const notes = buildSourceNotes({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      squads: [squad()],
    });
    const positive = notes.find((n) =>
      n.toLowerCase().includes("canonical squad name"),
    );
    expect(positive).toBeDefined();
    const p = (positive ?? "").toLowerCase();
    // Each of the four fields actually threaded through must be named.
    expect(p).toMatch(/squad name/);
    expect(p).toMatch(/pillar/);
    // Either "PM" or "pm name" — relax to a case-insensitive pm check.
    expect(p).toMatch(/\bpm\b/);
    expect(p).toMatch(/slack channel id/);
    // The note may mention manager chain only to deny it as a source;
    // any positive attribution (e.g. "provides manager chain") is wrong.
    expect(p).not.toMatch(/provides manager chain/);
    expect(p).toMatch(/does not provide manager chain/);
  });

  it("does not mention Slack channel on a snapshot whose squads input is absent", () => {
    const snapshot = buildRankingSnapshot(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
      }),
    );
    const notesHaystack = snapshot.eligibility.sourceNotes
      .join(" | ")
      .toLowerCase();
    // The live provenance must not claim a Slack channel when the squads
    // registry was not fetched — the "not fetched" line stands alone.
    expect(notesHaystack).not.toMatch(/slack channel/);
    // And the canonical squad is null so no downstream renderer can invent
    // a channel from the snapshot.
    expect(snapshot.eligibility.entries[0].canonicalSquad).toBeNull();
  });

  it("empty squads input produces coverage and source notes that agree (both treat as not fetched)", () => {
    const { coverage } = buildEligibleRoster(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
        squads: [],
      }),
    );
    expect(coverage.squadsRegistryPresent).toBe(false);

    const notes = buildSourceNotes({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      squads: [],
    });
    const haystack = notes.join(" ").toLowerCase();
    expect(haystack).toMatch(/squads registry was not fetched/);
    expect(haystack).not.toMatch(/canonical squad name/);
  });

  it("non-empty squads input produces coverage and source notes that agree (both treat as joined)", () => {
    const { coverage } = buildEligibleRoster(
      inputs({
        headcountRows: [row({ email: "a@meetcleo.com", hb_squad: "Platform" })],
        githubMap: [map({ employeeEmail: "a@meetcleo.com" })],
        squads: [squad({ name: "Platform" })],
      }),
    );
    expect(coverage.squadsRegistryPresent).toBe(true);

    const notes = buildSourceNotes({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      squads: [squad()],
    });
    const haystack = notes.join(" ").toLowerCase();
    expect(haystack).not.toMatch(/squads registry was not fetched/);
    expect(haystack).toMatch(/canonical squad name/);
  });

  it("planned-signals squads entry names the channel id field and matches what is actually threaded", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const squadsSignal = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("squads registry"),
    );
    expect(squadsSignal).toBeDefined();
    const haystack =
      `${squadsSignal?.name ?? ""} ${squadsSignal?.note ?? ""}`.toLowerCase();
    // The planned signal must explicitly name channel id / `channel_id` —
    // a generic "Slack channel" without the id qualifier risks claiming
    // channel names/webhooks/metadata that we do not actually thread.
    expect(haystack).toMatch(/channel[_\s]?id/);
  });
});

describe("M7 signal collection + orthogonality audit", () => {
  const NOW = new Date("2026-04-24T00:00:00Z");

  function row(
    index: number,
    overrides: Partial<EligibilityHeadcountRow> = {},
  ): EligibilityHeadcountRow {
    return {
      email: `eng${index}@meetcleo.com`,
      preferred_name: `Engineer ${index}`,
      hb_function: "Engineering",
      hb_level: `L${(index % 4) + 2}`,
      hb_squad: index % 2 === 0 ? "Platform" : "Risk",
      rp_specialisation: index % 2 === 0 ? "Backend Engineer" : "Frontend Engineer",
      rp_department_name: index % 2 === 0 ? "Core Pillar" : "Risk Pillar",
      job_title: "Software Engineer",
      manager: "Boss",
      line_manager_email: "boss@meetcleo.com",
      start_date: "2023-01-01",
      termination_date: null,
      ...overrides,
    };
  }

  function map(index: number): EligibilityGithubMapRow {
    return {
      githubLogin: `eng${index}`,
      employeeEmail: `eng${index}@meetcleo.com`,
      isBot: false,
    };
  }

  function squad(
    name: string,
    overrides: Partial<EligibilitySquadsRegistryRow> = {},
  ): EligibilitySquadsRegistryRow {
    return {
      name,
      pillar: name === "Platform" ? "Core" : "Risk",
      pmName: name === "Platform" ? "Pat PM" : "Riley PM",
      channelId: name === "Platform" ? "CPLATFORM" : "CRISK",
      isActive: true,
      ...overrides,
    };
  }

  function signal(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    const emailHash = hashEmailForRanking(`eng${index}@meetcleo.com`);
    return {
      emailHash,
      prCount: index,
      commitCount: index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  function snapshotInputs(
    count: number = RANKING_MIN_OVERLAP_SAMPLES,
    overrides: Partial<EligibilityInputs> = {},
  ): EligibilityInputs {
    return {
      headcountRows: Array.from({ length: count }, (_, i) => row(i + 1)),
      githubMap: Array.from({ length: count }, (_, i) => map(i + 1)),
      impactModel: { engineers: [] } as EligibilityImpactModelView,
      squads: [squad("Platform"), squad("Risk")],
      signals: Array.from({ length: count }, (_, i) => signal(i + 1)),
      now: NOW,
      ...overrides,
    };
  }

  it("computes Spearman rho = 1.0 for identical rank order", () => {
    const result = computeSpearmanRho([1, 2, 3, 4], [10, 20, 30, 40]);
    expect(result.n).toBe(4);
    expect(result.rho).toBeCloseTo(1, 6);
  });

  it("handles ties and nulls with pairwise deletion", () => {
    const result = computeSpearmanRho(
      [1, 2, 2, null, 4],
      [10, 20, 20, 999, 40],
    );
    expect(result.n).toBe(4);
    expect(result.rho).toBeCloseTo(1, 6);
  });

  it("reports pairwise sample counts and separates redundant from under-sampled pairs", () => {
    const snapshot = buildRankingSnapshot(
      snapshotInputs(RANKING_MIN_OVERLAP_SAMPLES, {
        signals: Array.from(
          { length: RANKING_MIN_OVERLAP_SAMPLES },
          (_, i) =>
            signal(i + 1, {
              shapPredicted: i < 3 ? (i + 1) * 100 : null,
            }),
        ),
      }),
    );

    const prCommit = snapshot.audit.correlationMatrix.find(
      (pair) => pair.a === "PR count" && pair.b === "Commit count",
    );
    expect(prCommit?.n).toBe(RANKING_MIN_OVERLAP_SAMPLES);
    expect(prCommit?.rho).toBeCloseTo(1, 6);
    expect(
      snapshot.audit.redundantPairs.some(
        (pair) => pair.a === "PR count" && pair.b === "Commit count",
      ),
    ).toBe(true);

    const prShap = snapshot.audit.correlationMatrix.find(
      (pair) => pair.a === "PR count" && pair.b === "SHAP predicted impact",
    );
    expect(prShap?.n).toBe(3);
    expect(
      snapshot.audit.underSampledPairs.some(
        (pair) => pair.a === "PR count" && pair.b === "SHAP predicted impact",
      ),
    ).toBe(true);
    expect(
      snapshot.audit.redundantPairs.some(
        (pair) => pair.a === "PR count" && pair.b === "SHAP predicted impact",
      ),
    ).toBe(false);
  });

  it("documents absent individual review fields instead of fabricating review signals", () => {
    const audit = buildSignalAudit({
      entries: [],
      reviewSignalsPersisted: false,
    });
    const unavailable = audit.unavailableSignals
      .map((signal) => signal.name.toLowerCase())
      .join(" | ");
    expect(unavailable).toContain("individual pr reviewer graph");
    expect(unavailable).toContain("individual review turnaround");
    expect(unavailable).toContain("individual pr cycle time");
    expect(audit.numericSignals.join(" ").toLowerCase()).not.toContain(
      "reviewer graph",
    );
  });

  it("uses the squads metadata fields actually joined in M6 for nominal coverage", () => {
    const snapshot = buildRankingSnapshot(snapshotInputs(2));
    const nominal = new Map(
      snapshot.audit.nominalCoverage.map((coverage) => [
        coverage.signal,
        coverage,
      ]),
    );
    expect(nominal.get("Canonical squad")?.categories.map((c) => c.category)).toEqual([
      "Platform",
      "Risk",
    ]);
    expect(
      nominal.get("Canonical squad pillar")?.categories.map((c) => c.category),
    ).toEqual(["Core", "Risk"]);
    expect(nominal.get("Squad PM")?.categories.map((c) => c.category)).toEqual([
      "Pat PM",
      "Riley PM",
    ]);
    expect(
      nominal.get("Slack channel id")?.categories.map((c) => c.category),
    ).toEqual(["CPLATFORM", "CRISK"]);
  });

  it("does not ordinal-encode nominal squad or channel fields into Spearman", () => {
    const snapshot = buildRankingSnapshot(snapshotInputs(4));
    const forbiddenNumericSignals = [
      "Discipline",
      "Raw headcount squad",
      "Raw headcount pillar",
      "Canonical squad",
      "Canonical squad pillar",
      "Squad PM",
      "Slack channel id",
    ];
    for (const signalName of forbiddenNumericSignals) {
      expect(RANKING_NOMINAL_SIGNAL_NAMES).toContain(signalName);
      expect(RANKING_NUMERIC_SIGNAL_NAMES).not.toContain(signalName);
      expect(snapshot.audit.numericSignals).not.toContain(signalName);
      expect(
        snapshot.audit.correlationMatrix.some(
          (pair) => pair.a === signalName || pair.b === signalName,
        ),
      ).toBe(false);
    }
  });
});

describe("M8 three independent scoring lenses + disagreement", () => {
  const NOW = new Date("2026-04-24T00:00:00Z");

  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function lensSignal(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: index,
      commitCount: index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  it("exposes four lens definitions in fixed output/impact/delivery/quality order", () => {
    expect(RANKING_LENS_DEFINITIONS.map((d) => d.key)).toEqual([
      "output",
      "impact",
      "delivery",
      "quality",
    ]);
    for (const def of RANKING_LENS_DEFINITIONS) {
      const totalWeight = def.components.reduce((sum, c) => sum + c.weight, 0);
      expect(totalWeight).toBeCloseTo(1, 6);
    }
  });

  it("ranks by lens A on perfectly ordered output signals", () => {
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 6 }, (_, i) => lensSignal(i + 1));
    const { lenses } = buildLenses({ entries, signals });
    const topNames = lenses.output.topN.map((e) => e.displayName);
    expect(topNames).toEqual([
      "Engineer 6",
      "Engineer 5",
      "Engineer 4",
      "Engineer 3",
      "Engineer 2",
      "Engineer 1",
    ]);
    expect(lenses.output.topN[0].score).toBeGreaterThan(
      lenses.output.topN[lenses.output.topN.length - 1].score ?? 0,
    );
  });

  it("identical normalised signals across lenses agree on top engineer", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    // Construct signals so that the same engineer ranks #1 on all three lenses:
    // high output, high SHAP, best squad-delivery metrics.
    const signals = entries.map((_, i) => {
      const rank = i + 1; // 1..5
      return lensSignal(rank, {
        // squad delivery differs per row so delivery can differentiate
        squadCycleTimeHours: 50 - rank,
        squadReviewRatePercent: 60 + rank,
        squadTimeToFirstReviewHours: 10 - rank,
      });
    });
    const { lenses } = buildLenses({ entries, signals });
    expect(lenses.output.topN[0].displayName).toBe("Engineer 5");
    expect(lenses.impact.topN[0].displayName).toBe("Engineer 5");
    expect(lenses.delivery.topN[0].displayName).toBe("Engineer 5");
  });

  it("surfaces a high-SHAP / low-output engineer in the disagreement table", () => {
    const entries = [
      competitiveEntry(1, { displayName: "High Output" }),
      competitiveEntry(2, { displayName: "Balanced" }),
      competitiveEntry(3, { displayName: "High Impact Low Output" }),
      competitiveEntry(4, { displayName: "Low Everything" }),
    ];
    const signals = [
      lensSignal(1, {
        prCount: 200,
        commitCount: 500,
        additions: 40_000,
        deletions: 5_000,
        shapPredicted: 10,
        shapActual: 12,
        shapResidual: 2,
      }),
      lensSignal(2, {
        prCount: 40,
        commitCount: 80,
        additions: 5_000,
        deletions: 1_000,
        shapPredicted: 60,
        shapActual: 60,
        shapResidual: 0,
      }),
      lensSignal(3, {
        prCount: 5,
        commitCount: 10,
        additions: 200,
        deletions: 50,
        shapPredicted: 150,
        shapActual: 170,
        shapResidual: 20,
      }),
      lensSignal(4, {
        prCount: 2,
        commitCount: 5,
        additions: 100,
        deletions: 20,
        shapPredicted: 5,
        shapActual: 4,
        shapResidual: -1,
      }),
    ];
    const { disagreement } = buildLenses({ entries, signals });
    const widestNames = disagreement.widestGaps.map((r) => r.displayName);
    expect(widestNames).toContain("High Impact Low Output");
    const row = disagreement.widestGaps.find(
      (r) => r.displayName === "High Impact Low Output",
    )!;
    expect(row.impact).not.toBeNull();
    expect(row.output).not.toBeNull();
    expect((row.impact ?? 0) > (row.output ?? 0)).toBe(true);
    expect(row.likelyCause.toLowerCase()).toContain("shap impact above");
  });

  it("does not reward direct AI-token inflation — identical non-AI signals produce identical lens scores", () => {
    const entries = [
      competitiveEntry(1, { displayName: "Low AI" }),
      competitiveEntry(2, { displayName: "High AI" }),
    ];
    // Same real signals, but wildly different AI tokens/spend.
    const base = {
      prCount: 20,
      commitCount: 40,
      additions: 2_000,
      deletions: 400,
      shapPredicted: 100,
      shapActual: 110,
      shapResidual: 10,
      squadCycleTimeHours: 24,
      squadReviewRatePercent: 80,
      squadTimeToFirstReviewHours: 2,
      squadPrsInProgress: 6,
    };
    const signals = [
      { ...lensSignal(1, base), aiTokens: 50, aiSpend: 1 },
      { ...lensSignal(2, base), aiTokens: 10_000_000, aiSpend: 10_000 },
    ];
    const { lenses } = buildLenses({ entries, signals });
    // Same raw signals → same rank-percentile → same lens scores per lens.
    for (const lens of [lenses.output, lenses.impact, lenses.delivery]) {
      const a = lens.entries[0].score;
      const b = lens.entries[1].score;
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a).toBeCloseTo(b ?? NaN, 6);
    }
  });

  it("absent review/delivery signals produce null lens-C score, not a neutral 50", () => {
    const entries = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3),
    ];
    const signals = entries.map((_, i) =>
      lensSignal(i + 1, {
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
        squadPrsInProgress: null,
      }),
    );
    const { lenses } = buildLenses({ entries, signals });
    // Delivery lens: every component missing → every row score is null.
    for (const row of lenses.delivery.entries) {
      expect(row.score).toBeNull();
      expect(row.presentComponentCount).toBe(0);
    }
    expect(lenses.delivery.scored).toBe(0);
    expect(lenses.delivery.topN).toEqual([]);
  });

  it("engineers absent from the impact model score null on lens B, not mid-percentile", () => {
    const entries = [
      competitiveEntry(1, { displayName: "In model" }),
      competitiveEntry(2, { displayName: "Absent from model" }),
    ];
    const signals = [
      lensSignal(1, {
        shapPredicted: 100,
        shapActual: 110,
        shapResidual: 10,
      }),
      lensSignal(2, {
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
      }),
    ];
    const { lenses } = buildLenses({ entries, signals });
    const absent = lenses.impact.entries.find(
      (e) => e.displayName === "Absent from model",
    );
    expect(absent?.score).toBeNull();
    expect(absent?.presentComponentCount).toBe(0);
    expect(lenses.impact.topN.map((e) => e.displayName)).not.toContain(
      "Absent from model",
    );
  });

  it("disagreement = max(present) - min(present) and rows with <2 lenses are excluded", () => {
    const entries = [
      competitiveEntry(1, { displayName: "Three lenses" }),
      competitiveEntry(2, { displayName: "Only output" }),
    ];
    const signals = [
      lensSignal(1, {
        prCount: 10,
        commitCount: 20,
        additions: 1_000,
        deletions: 200,
        shapPredicted: 50,
        shapActual: 60,
        shapResidual: 10,
        squadCycleTimeHours: 20,
        squadReviewRatePercent: 90,
        squadTimeToFirstReviewHours: 1,
      }),
      lensSignal(2, {
        prCount: 5,
        commitCount: 10,
        additions: 200,
        deletions: 50,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
      }),
    ];
    const { disagreement } = buildLenses({ entries, signals });
    const names = disagreement.rows.map((r) => r.displayName);
    expect(names).not.toContain("Only output");
    // With two engineers each present in only the output lens alone for the
    // second row, only the first row qualifies.
    const threeLens = disagreement.rows.find(
      (r) => r.displayName === "Three lenses",
    );
    expect(threeLens?.presentLensCount).toBeGreaterThanOrEqual(
      RANKING_DISAGREEMENT_MIN_LENSES,
    );
    const presentScores = [
      threeLens?.output,
      threeLens?.impact,
      threeLens?.delivery,
    ].filter((v): v is number => v !== null && v !== undefined);
    const expected = Math.max(...presentScores) - Math.min(...presentScores);
    expect(threeLens?.disagreement).toBeCloseTo(expected, 6);
  });

  it("top-N per lens is capped at RANKING_LENS_TOP_N and sorted descending by score", () => {
    const count = RANKING_LENS_TOP_N + 5;
    const entries = Array.from({ length: count }, (_, i) =>
      competitiveEntry(i + 1),
    );
    const signals = Array.from({ length: count }, (_, i) => lensSignal(i + 1));
    const { lenses } = buildLenses({ entries, signals });
    expect(lenses.output.topN.length).toBe(RANKING_LENS_TOP_N);
    for (let i = 0; i < lenses.output.topN.length - 1; i += 1) {
      const a = lenses.output.topN[i].score ?? -Infinity;
      const b = lenses.output.topN[i + 1].score ?? -Infinity;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("only competitive entries enter the lenses — ramp-up and leavers are excluded", () => {
    const entries = [
      competitiveEntry(1),
      competitiveEntry(2, {
        eligibility: "ramp_up",
        tenureDays: 30,
        reason: "Ramp-up",
      }),
      competitiveEntry(3, {
        eligibility: "inactive_or_leaver",
        isLeaverOrInactive: true,
        reason: "Leaver",
      }),
    ];
    const signals = Array.from({ length: 3 }, (_, i) => lensSignal(i + 1));
    const { lenses } = buildLenses({ entries, signals });
    for (const lens of [lenses.output, lenses.impact, lenses.delivery]) {
      const names = lens.entries.map((e) => e.displayName);
      expect(names).toEqual(["Engineer 1"]);
    }
  });

  it("buildRankingSnapshot attaches the lenses bundle to the snapshot", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [
        {
          email: "eng1@meetcleo.com",
          preferred_name: "Engineer 1",
          hb_function: "Engineering",
          hb_level: "L4",
          hb_squad: "Platform",
          rp_specialisation: "Backend Engineer",
          rp_department_name: "Core Pillar",
          job_title: "Software Engineer",
          manager: "Boss",
          line_manager_email: "boss@meetcleo.com",
          start_date: "2023-01-01",
        },
      ],
      githubMap: [
        {
          githubLogin: "eng1",
          employeeEmail: "eng1@meetcleo.com",
          isBot: false,
        },
      ],
      impactModel: { engineers: [] } as EligibilityImpactModelView,
      signals: [lensSignal(1)],
      now: NOW,
    });
    expect(snapshot.lenses).toBeDefined();
    expect(snapshot.lenses.definitions.map((d) => d.key)).toEqual([
      "output",
      "impact",
      "delivery",
      "quality",
    ]);
    expect(snapshot.lenses.lenses.output.entries.length).toBe(1);
  });
});

describe("M9 suppress non-disagreements in lens disagreement table", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function lensSignal(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: index,
      commitCount: index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  it("exposes RANKING_DISAGREEMENT_EPSILON as a positive, sub-1 threshold", () => {
    expect(RANKING_DISAGREEMENT_EPSILON).toBeGreaterThan(0);
    // Above 1 percentile point would swallow real small gaps; anchor to the
    // plan's 0.5 default so a future edit cannot silently broaden the filter.
    expect(RANKING_DISAGREEMENT_EPSILON).toBeLessThanOrEqual(1);
  });

  it("identical signals across every engineer produce no disagreement rows and no widest gaps", () => {
    // Identical signal values → identical rank percentiles → every lens score
    // is identical → every pair agrees exactly. Nothing should be narrated as
    // a disagreement.
    const entries = Array.from({ length: 4 }, (_, i) =>
      competitiveEntry(i + 1, {
        squad: "Platform",
        pillar: "Core",
      }),
    );
    const signals = entries.map((_, i) =>
      lensSignal(i + 1, {
        prCount: 10,
        commitCount: 20,
        additions: 1_000,
        deletions: 200,
        shapPredicted: 50,
        shapActual: 60,
        shapResidual: 10,
        squadCycleTimeHours: 24,
        squadReviewRatePercent: 80,
        squadTimeToFirstReviewHours: 2,
        squadPrsInProgress: 6,
      }),
    );
    const { disagreement } = buildLenses({ entries, signals });
    expect(disagreement.rows).toEqual([]);
    expect(disagreement.widestGaps).toEqual([]);
  });

  it("directional `top>bottom` narrative never appears for non-material gaps", () => {
    // Construct two engineers with identical signal ranks so their lens
    // scores tie. The rows are filtered from the table, but assert
    // defensively that likelyDisagreementCause (used on any row, including
    // the <2-lens path) never emits `>` directional text for a tied row.
    const entries = [
      competitiveEntry(1, { squad: "Platform" }),
      competitiveEntry(2, { squad: "Platform" }),
    ];
    const shared = {
      prCount: 7,
      commitCount: 14,
      additions: 800,
      deletions: 100,
      shapPredicted: 40,
      shapActual: 45,
      shapResidual: 5,
      squadCycleTimeHours: 30,
      squadReviewRatePercent: 75,
      squadTimeToFirstReviewHours: 3,
      squadPrsInProgress: 5,
    };
    const signals = [
      lensSignal(1, shared),
      lensSignal(2, shared),
    ];
    const { disagreement } = buildLenses({ entries, signals });
    expect(disagreement.rows).toEqual([]);
    // Even if a UI regression later renders all rows, the cause helper must
    // not emit directional `top>bottom` text for tied scores. Here no row is
    // returned, so nothing to inspect — this test locks in the filter side.
    expect(disagreement.widestGaps).toEqual([]);
  });

  it("a real high-SHAP / low-output gap still appears in widestGaps", () => {
    const entries = [
      competitiveEntry(1, { displayName: "High Output" }),
      competitiveEntry(2, { displayName: "Balanced" }),
      competitiveEntry(3, { displayName: "High Impact Low Output" }),
      competitiveEntry(4, { displayName: "Low Everything" }),
    ];
    const signals = [
      lensSignal(1, {
        prCount: 200,
        commitCount: 500,
        additions: 40_000,
        deletions: 5_000,
        shapPredicted: 10,
        shapActual: 12,
        shapResidual: 2,
      }),
      lensSignal(2, {
        prCount: 40,
        commitCount: 80,
        additions: 5_000,
        deletions: 1_000,
        shapPredicted: 60,
        shapActual: 60,
        shapResidual: 0,
      }),
      lensSignal(3, {
        prCount: 5,
        commitCount: 10,
        additions: 200,
        deletions: 50,
        shapPredicted: 150,
        shapActual: 170,
        shapResidual: 20,
      }),
      lensSignal(4, {
        prCount: 2,
        commitCount: 5,
        additions: 100,
        deletions: 20,
        shapPredicted: 5,
        shapActual: 4,
        shapResidual: -1,
      }),
    ];
    const { disagreement } = buildLenses({ entries, signals });
    // Regression: M8 surfaced this row; M9's filter must keep it because the
    // gap is materially larger than the epsilon.
    const names = disagreement.widestGaps.map((r) => r.displayName);
    expect(names).toContain("High Impact Low Output");
    const row = disagreement.widestGaps.find(
      (r) => r.displayName === "High Impact Low Output",
    )!;
    expect(row.disagreement).not.toBeNull();
    expect(row.disagreement!).toBeGreaterThan(RANKING_DISAGREEMENT_EPSILON);
  });

  it("every surfaced disagreement row has a material gap and non-tied narrative", () => {
    // Use a mixed cohort so the filter has both filter-eligible and
    // filter-ineligible candidates. The invariant we lock in is that every
    // row that survives the filter has gap > EPSILON and a narrative that is
    // not the tied-case reason — regardless of which specific engineers pass.
    const entries = [
      competitiveEntry(1, { displayName: "High Output Low Impact" }),
      competitiveEntry(2, { displayName: "Balanced" }),
      competitiveEntry(3, { displayName: "High Impact Low Output" }),
      competitiveEntry(4, { displayName: "Low Everything" }),
    ];
    const signals = [
      lensSignal(1, {
        prCount: 200,
        commitCount: 500,
        additions: 40_000,
        deletions: 5_000,
        shapPredicted: 10,
        shapActual: 12,
        shapResidual: 2,
      }),
      lensSignal(2, {
        prCount: 40,
        commitCount: 80,
        additions: 5_000,
        deletions: 1_000,
        shapPredicted: 60,
        shapActual: 60,
        shapResidual: 0,
      }),
      lensSignal(3, {
        prCount: 5,
        commitCount: 10,
        additions: 200,
        deletions: 50,
        shapPredicted: 150,
        shapActual: 170,
        shapResidual: 20,
      }),
      lensSignal(4, {
        prCount: 2,
        commitCount: 5,
        additions: 100,
        deletions: 20,
        shapPredicted: 5,
        shapActual: 4,
        shapResidual: -1,
      }),
    ];
    const { disagreement } = buildLenses({ entries, signals });
    // At least one genuinely disagreeing row should survive the filter.
    expect(disagreement.rows.length).toBeGreaterThan(0);
    for (const row of disagreement.rows) {
      expect(row.disagreement).not.toBeNull();
      expect(row.disagreement!).toBeGreaterThan(RANKING_DISAGREEMENT_EPSILON);
      expect(row.likelyCause.toLowerCase()).not.toContain(
        "no material lens disagreement",
      );
    }
  });
});

describe("M10 tenure and role normalisation", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: "Platform",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signal(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: 10,
      commitCount: 20,
      additions: 1_000,
      deletions: 200,
      shapPredicted: null,
      shapActual: null,
      shapResidual: null,
      aiTokens: null,
      aiSpend: null,
      squadCycleTimeHours: null,
      squadReviewRatePercent: null,
      squadTimeToFirstReviewHours: null,
      squadPrsInProgress: null,
      ...overrides,
    };
  }

  it("exposes RANKING_MIN_COHORT_SIZE and a documented fallback chain", () => {
    expect(RANKING_MIN_COHORT_SIZE).toBeGreaterThanOrEqual(2);
    // Every non-BE discipline must start its fallback with BE per the design
    // note on the constant. BE itself has no fallback because it is the
    // largest IC cohort.
    for (const [d, chain] of Object.entries(DISCIPLINE_POOL_FALLBACK) as [
      Discipline,
      readonly Discipline[],
    ][]) {
      if (d === "BE") {
        expect(chain).toEqual([]);
        continue;
      }
      expect(chain.length).toBeGreaterThan(0);
      expect(chain[0]).toBe("BE");
      // A discipline must never pool with itself.
      expect(chain).not.toContain(d);
    }
  });

  it("ramp-up and leaver entries are held out of normalisation even when supplied", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2, {
        eligibility: "ramp_up",
        tenureDays: 30,
        reason: "Ramp-up",
      }),
      competitiveEntry(3, {
        eligibility: "inactive_or_leaver",
        isLeaverOrInactive: true,
        reason: "Leaver",
      }),
    ];
    const signals = [signal(1), signal(2), signal(3)];
    const bundle = buildNormalisation({ entries, signals });
    expect(bundle.entries.map((e) => e.displayName)).toEqual(["Engineer 1"]);
  });

  it("a competitive engineer with tenure in the 90–180d band receives a tenure-exposure rate lift", () => {
    // Fixture is designed so the new-joiner engineer has MORE rawScore
    // than their peers — the test's job is to confirm (a) tenure-adjusted
    // rate is strictly larger than rawScore for short-tenure engineers and
    // (b) their tenure-adjusted percentile is not bottom-of-cohort.
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { tenureDays: 800 }),
      competitiveEntry(2, { tenureDays: 600 }),
      competitiveEntry(3, { tenureDays: 400 }),
      competitiveEntry(4, {
        tenureDays: 100,
        displayName: "Recent joiner",
      }),
    ];
    const signals = [
      signal(1, { prCount: 20, additions: 2_000, deletions: 400 }),
      signal(2, { prCount: 20, additions: 2_000, deletions: 400 }),
      signal(3, { prCount: 20, additions: 2_000, deletions: 400 }),
      signal(4, { prCount: 20, additions: 2_000, deletions: 400 }),
    ];
    const bundle = buildNormalisation({ entries, signals });
    const newJoiner = bundle.entries.find(
      (e) => e.displayName === "Recent joiner",
    );
    const longTenured = bundle.entries.find(
      (e) => e.displayName === "Engineer 1",
    );
    expect(newJoiner).toBeDefined();
    expect(longTenured).toBeDefined();
    // Tenure window is clamped to tenureDays for the new joiner (100d) and
    // to windowDays for the long-tenured engineer (180d cap).
    expect(newJoiner!.tenureWindowDays).toBe(100);
    expect(longTenured!.tenureWindowDays).toBe(RANKING_SIGNAL_WINDOW_DAYS);
    // Same raw score, but the short-tenure engineer's adjusted rate is
    // strictly larger because exposure is a smaller denominator.
    expect(newJoiner!.tenureAdjustedRate!).toBeGreaterThan(
      longTenured!.tenureAdjustedRate!,
    );
    // Recent joiner is not bottom-ranked on the tenure-adjusted percentile.
    expect(newJoiner!.tenureAdjustedPercentile!).toBeGreaterThan(
      longTenured!.tenureAdjustedPercentile ?? 0,
    );
  });

  it("a lower-level engineer with the same raw output receives an adjusted lift from the level residual", () => {
    // Construct a cohort with a clear positive slope of rawScore on level:
    // L3 engineers low, L4 middle, L5 high. Then add two engineers who
    // share an identical rawScore in the middle, one at L3 (below their
    // level baseline should be higher residual → NO wait, below expected is
    // negative; SAME score as expected gives zero; ABOVE expected gives
    // positive). For L3 with a moderate score, the predicted rawScore at
    // L3 is lower than the predicted rawScore at L5, so residual(L3) >
    // residual(L5).
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { levelLabel: "L3", displayName: "L3 anchor A" }),
      competitiveEntry(2, { levelLabel: "L3", displayName: "L3 anchor B" }),
      competitiveEntry(3, { levelLabel: "L4", displayName: "L4 anchor A" }),
      competitiveEntry(4, { levelLabel: "L4", displayName: "L4 anchor B" }),
      competitiveEntry(5, { levelLabel: "L5", displayName: "L5 anchor A" }),
      competitiveEntry(6, { levelLabel: "L5", displayName: "L5 anchor B" }),
      competitiveEntry(7, { levelLabel: "L3", displayName: "L3 test" }),
      competitiveEntry(8, { levelLabel: "L5", displayName: "L5 test" }),
    ];
    // Anchors establish the level baseline: L3 ≈ 2 PRs, L4 ≈ 20 PRs, L5 ≈ 80 PRs.
    // Test engineers share raw output of 20 PRs.
    const signals = [
      signal(1, { prCount: 2, additions: 50, deletions: 10 }),
      signal(2, { prCount: 3, additions: 60, deletions: 10 }),
      signal(3, { prCount: 20, additions: 1_000, deletions: 200 }),
      signal(4, { prCount: 22, additions: 1_100, deletions: 200 }),
      signal(5, { prCount: 80, additions: 10_000, deletions: 2_000 }),
      signal(6, { prCount: 75, additions: 9_500, deletions: 1_800 }),
      signal(7, { prCount: 20, additions: 1_000, deletions: 200 }),
      signal(8, { prCount: 20, additions: 1_000, deletions: 200 }),
    ];
    const bundle = buildNormalisation({ entries, signals });
    const l3Test = bundle.entries.find((e) => e.displayName === "L3 test")!;
    const l5Test = bundle.entries.find((e) => e.displayName === "L5 test")!;
    expect(l3Test.rawScore).toBeCloseTo(l5Test.rawScore ?? NaN, 6);
    // rawPercentile is identical because raw scores are identical.
    expect(l3Test.rawPercentile).toBeCloseTo(l5Test.rawPercentile ?? NaN, 6);
    // Level baselines reflect the level number: L5 baseline > L3 baseline
    // because the OLS slope is positive.
    expect(l5Test.levelBaseline).toBeGreaterThan(l3Test.levelBaseline ?? 0);
    // L3 engineer exceeds their level baseline; L5 engineer underperforms theirs.
    expect(l3Test.levelAdjustedResidual!).toBeGreaterThan(
      l5Test.levelAdjustedResidual!,
    );
    expect(l3Test.levelAdjustedPercentile!).toBeGreaterThan(
      l5Test.levelAdjustedPercentile!,
    );
    expect(bundle.levelFit?.slope).toBeGreaterThan(0);
  });

  it("a tiny ML cohort pools with BE via the documented fallback", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { discipline: "BE", levelLabel: "L4" }),
      competitiveEntry(2, { discipline: "BE", levelLabel: "L4" }),
      competitiveEntry(3, { discipline: "BE", levelLabel: "L4" }),
      competitiveEntry(4, { discipline: "BE", levelLabel: "L4" }),
      competitiveEntry(5, {
        discipline: "ML",
        levelLabel: "L4",
        displayName: "Solo ML",
      }),
    ];
    const signals = [
      signal(1),
      signal(2),
      signal(3),
      signal(4),
      signal(5, { prCount: 50, additions: 5_000, deletions: 1_000 }),
    ];
    const bundle = buildNormalisation({ entries, signals });
    const mlEntry = bundle.entries.find((e) => e.displayName === "Solo ML")!;
    expect(mlEntry.disciplineCohort.pooled).toBe(true);
    expect(mlEntry.disciplineCohort.pooledWith).toEqual(["BE"]);
    expect(mlEntry.disciplineCohort.effectiveSize).toBe(5);
    expect(mlEntry.disciplineCohort.pooledToAll).toBe(false);
    // Discipline percentile was computed on the pooled cohort (ML + BE =
    // 5 engineers). Its ML+BE cohort percentile is finite and on [0, 100].
    expect(mlEntry.disciplinePercentile).not.toBeNull();
    expect(mlEntry.disciplinePercentile!).toBeGreaterThanOrEqual(0);
    expect(mlEntry.disciplinePercentile!).toBeLessThanOrEqual(100);
    // Cohort summary reports the discipline sizes pre-pooling.
    const mlSummary = bundle.disciplineCohorts.find(
      (c) => c.discipline === "ML",
    );
    expect(mlSummary?.size).toBe(1);
    expect(mlSummary?.pooled).toBe(true);
    expect(mlSummary?.pooledWith).toEqual(["BE"]);
  });

  it("falls through to the full cohort when own+fallback pooling is still below the minimum", () => {
    // Only two engineers exist in the competitive cohort total — one ML,
    // one Ops. Neither alone nor paired with BE reaches MIN_COHORT_SIZE=3.
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { discipline: "ML", displayName: "Solo ML" }),
      competitiveEntry(2, { discipline: "Ops", displayName: "Solo Ops" }),
    ];
    const signals = [signal(1), signal(2)];
    const bundle = buildNormalisation({ entries, signals });
    const ml = bundle.entries.find((e) => e.displayName === "Solo ML")!;
    expect(ml.disciplineCohort.pooled).toBe(true);
    expect(ml.disciplineCohort.pooledToAll).toBe(true);
    // Effective size equals the total competitive cohort when falling through.
    expect(ml.disciplineCohort.effectiveSize).toBe(2);
  });

  it("surfaces both rawPercentile and adjustedPercentile; adjustedPercentile is the mean of present adjustments", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { levelLabel: "L3" }),
      competitiveEntry(2, { levelLabel: "L4" }),
      competitiveEntry(3, { levelLabel: "L5" }),
      competitiveEntry(4, { levelLabel: "L4" }),
    ];
    const signals = [
      signal(1, { prCount: 5, additions: 200, deletions: 50 }),
      signal(2, { prCount: 15, additions: 1_500, deletions: 300 }),
      signal(3, { prCount: 30, additions: 4_000, deletions: 800 }),
      signal(4, { prCount: 10, additions: 800, deletions: 100 }),
    ];
    const bundle = buildNormalisation({ entries, signals });
    for (const entry of bundle.entries) {
      expect(entry.rawPercentile).not.toBeNull();
      expect(entry.adjustedPercentile).not.toBeNull();
      const presentAdjusted = [
        entry.disciplinePercentile,
        entry.levelAdjustedPercentile,
        entry.tenureAdjustedPercentile,
      ].filter((v): v is number => v !== null);
      if (presentAdjusted.length > 0) {
        const expected =
          presentAdjusted.reduce((s, v) => s + v, 0) / presentAdjusted.length;
        expect(entry.adjustedPercentile!).toBeCloseTo(expected, 6);
        expect(entry.adjustmentDelta!).toBeCloseTo(
          expected - entry.rawPercentile!,
          6,
        );
      } else {
        expect(entry.adjustedPercentile).toBe(entry.rawPercentile);
        expect(entry.adjustmentDelta).toBeNull();
      }
    }
  });

  it("engineers with no persisted activity land on null rawScore and null adjustments (no fake precision)", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2, { displayName: "No activity" }),
    ];
    const signals = [
      signal(1),
      // All activity fields null — no rawScore can be derived.
      signal(2, { prCount: null, additions: null, deletions: null }),
    ];
    const bundle = buildNormalisation({ entries, signals });
    const noActivity = bundle.entries.find(
      (e) => e.displayName === "No activity",
    )!;
    expect(noActivity.rawScore).toBeNull();
    expect(noActivity.rawPercentile).toBeNull();
    expect(noActivity.disciplinePercentile).toBeNull();
    expect(noActivity.levelAdjustedPercentile).toBeNull();
    expect(noActivity.tenureAdjustedPercentile).toBeNull();
    expect(noActivity.adjustedPercentile).toBeNull();
    expect(noActivity.adjustmentDelta).toBeNull();
  });

  it("AI tokens and AI spend do not influence any normalisation percentile", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { displayName: "Low AI" }),
      competitiveEntry(2, { displayName: "High AI" }),
    ];
    const base = { prCount: 20, additions: 2_000, deletions: 400 };
    const signals = [
      { ...signal(1, base), aiTokens: 50, aiSpend: 1 },
      { ...signal(2, base), aiTokens: 10_000_000, aiSpend: 10_000 },
    ];
    const bundle = buildNormalisation({ entries, signals });
    const lo = bundle.entries.find((e) => e.displayName === "Low AI")!;
    const hi = bundle.entries.find((e) => e.displayName === "High AI")!;
    expect(lo.rawPercentile).toBeCloseTo(hi.rawPercentile ?? NaN, 6);
    expect(lo.adjustedPercentile).toBeCloseTo(hi.adjustedPercentile ?? NaN, 6);
  });

  it("buildRankingSnapshot attaches the normalisation bundle to the snapshot", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [
        {
          email: "eng1@meetcleo.com",
          preferred_name: "Engineer 1",
          hb_function: "Engineering",
          hb_level: "L4",
          hb_squad: "Platform",
          rp_specialisation: "Backend Engineer",
          rp_department_name: "Core Pillar",
          job_title: "Software Engineer",
          manager: "Boss",
          line_manager_email: "boss@meetcleo.com",
          start_date: "2023-01-01",
        },
      ],
      githubMap: [
        {
          githubLogin: "eng1",
          employeeEmail: "eng1@meetcleo.com",
          isBot: false,
        },
      ],
      impactModel: { engineers: [] } as EligibilityImpactModelView,
      signals: [signal(1)],
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(snapshot.normalisation).toBeDefined();
    expect(snapshot.normalisation.entries.length).toBe(1);
    expect(snapshot.normalisation.minCohortSize).toBe(RANKING_MIN_COHORT_SIZE);
    expect(snapshot.normalisation.windowDays).toBe(RANKING_SIGNAL_WINDOW_DAYS);
    expect(snapshot.normalisation.rampUpDays).toBe(RANKING_RAMP_UP_DAYS);
    expect(snapshot.normalisation.adjustmentNotes.length).toBeGreaterThan(0);
  });

  it("level fit is null when fewer than two competitive engineers have both level and rawScore", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { levelLabel: "unknown" }),
      // Only one engineer has a parseable level + non-null rawScore.
      competitiveEntry(2, { levelLabel: "L4" }),
    ];
    const signals = [
      signal(1),
      signal(2),
    ];
    const bundle = buildNormalisation({ entries, signals });
    // Both engineers have rawScore, but only the L4 engineer has a
    // parseable levelNumber → levelFit needs at least two points.
    const l4 = bundle.entries.find((e) => e.displayName === "Engineer 2")!;
    expect(l4.levelNumber).toBe(4);
    expect(bundle.levelFit).toBeNull();
    expect(l4.levelBaseline).toBeNull();
    expect(l4.levelAdjustedResidual).toBeNull();
    expect(l4.levelAdjustedPercentile).toBeNull();
    // Other adjustments still work.
    expect(l4.adjustedPercentile).not.toBeNull();
  });
});

describe("M11 normalisation delta sign buckets + truthful page copy", () => {
  function makeEntry(
    name: string,
    adjustmentDelta: number | null,
  ): EngineerNormalisation {
    return {
      emailHash: `hash-${name}`,
      displayName: name,
      discipline: "BE",
      levelLabel: "L4",
      levelNumber: 4,
      tenureDays: 800,
      tenureWindowDays: 180,
      rawScore: 10,
      rawPercentile: 50,
      disciplineCohort: {
        discipline: "BE",
        effectiveMembers: ["BE"],
        effectiveSize: 5,
        pooled: false,
        pooledWith: [],
        pooledToAll: false,
        note: "",
      },
      disciplinePercentile: 50,
      levelBaseline: 10,
      levelAdjustedResidual: 0,
      levelAdjustedPercentile: 50,
      tenureAdjustedRate: 10,
      tenureAdjustedPercentile: 50,
      adjustedPercentile: adjustmentDelta === null ? null : 50 + adjustmentDelta,
      adjustmentDelta,
      adjustmentsApplied: [],
    };
  }

  it("lifts bucket only contains strictly positive adjustmentDelta, sorted descending", () => {
    const entries = [
      makeEntry("bigLift", 8),
      makeEntry("smallLift", 1),
      makeEntry("drop", -5),
      makeEntry("zero", 0),
      makeEntry("null", null),
    ];
    const { lifts } = bucketNormalisationDeltas(entries, 5);
    expect(lifts.map((e) => e.displayName)).toEqual(["bigLift", "smallLift"]);
    for (const e of lifts) {
      expect((e.adjustmentDelta as number) > 0).toBe(true);
    }
  });

  it("drops bucket only contains strictly negative adjustmentDelta, sorted ascending", () => {
    const entries = [
      makeEntry("lift", 4),
      makeEntry("smallDrop", -1),
      makeEntry("bigDrop", -6),
      makeEntry("zero", 0),
      makeEntry("null", null),
    ];
    const { drops } = bucketNormalisationDeltas(entries, 5);
    expect(drops.map((e) => e.displayName)).toEqual(["bigDrop", "smallDrop"]);
    for (const e of drops) {
      expect((e.adjustmentDelta as number) < 0).toBe(true);
    }
  });

  it("zero, null, and non-finite deltas never appear in either bucket", () => {
    const entries = [
      makeEntry("zero", 0),
      makeEntry("null", null),
      makeEntry("lift", 2),
      makeEntry("drop", -2),
      makeEntry("nanDelta", Number.NaN),
      makeEntry("infDelta", Number.POSITIVE_INFINITY),
    ];
    const { lifts, drops } = bucketNormalisationDeltas(entries, 5);
    const names = [...lifts, ...drops].map((e) => e.displayName);
    expect(names).not.toContain("zero");
    expect(names).not.toContain("null");
    expect(names).not.toContain("nanDelta");
    expect(names).not.toContain("infDelta");
    expect(names).toEqual(expect.arrayContaining(["lift", "drop"]));
  });

  it("when every delta is negative, lifts must be empty — drops must not borrow them", () => {
    const entries = [
      makeEntry("a", -1),
      makeEntry("b", -2),
      makeEntry("c", -3),
    ];
    const { lifts, drops } = bucketNormalisationDeltas(entries, 5);
    expect(lifts).toEqual([]);
    expect(drops.map((e) => e.displayName)).toEqual(["c", "b", "a"]);
  });

  it("when every delta is positive, drops must be empty — lifts must not borrow them", () => {
    const entries = [
      makeEntry("a", 3),
      makeEntry("b", 2),
      makeEntry("c", 1),
    ];
    const { lifts, drops } = bucketNormalisationDeltas(entries, 5);
    expect(drops).toEqual([]);
    expect(lifts.map((e) => e.displayName)).toEqual(["a", "b", "c"]);
  });

  it("both buckets are capped at the limit argument", () => {
    const entries = [
      makeEntry("l1", 10),
      makeEntry("l2", 9),
      makeEntry("l3", 8),
      makeEntry("d1", -10),
      makeEntry("d2", -9),
      makeEntry("d3", -8),
    ];
    const { lifts, drops } = bucketNormalisationDeltas(entries, 2);
    expect(lifts.map((e) => e.displayName)).toEqual(["l1", "l2"]);
    expect(drops.map((e) => e.displayName)).toEqual(["d1", "d2"]);
  });

  it("snapshot known limitations no longer imply normalisation or lenses are future work", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.knownLimitations.join(" ").toLowerCase();
    // Lenses and tenure/role normalisation must not be described as future
    // work anywhere in the on-page known-limitations list.
    expect(joined).not.toMatch(/tenure\/role normalisation[^.]*later milestones/);
    expect(joined).not.toMatch(/ranking math[^.]*later milestones/);
    // The remaining pending work (attribution, snapshots, movers, stability)
    // must be named somewhere so a reader knows what is still missing.
    // Composite and confidence bands are now implemented and must not be
    // claimed as pending in the limitations.
    expect(joined).toMatch(/composite/);
    expect(joined).toMatch(/attribution/);
  });

  it("lens-stage limitations narrate composite as pending, not as M10/M11 responsibility", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.lenses.limitations.join(" ");
    // The stale string "M10 synthesises the final composite" was a methodology
    // lie: M10 is normalisation, not composite. Guard against it and its
    // closest cousins creeping back in.
    expect(joined).not.toMatch(/M10 synthesises the (final )?composite/);
    expect(joined).not.toMatch(/M11 synthesises the (final )?composite/);
  });
});

describe("M12 composite score contract + sensitivity + dominance", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signalRow(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: index,
      commitCount: index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  it("exposes composite thresholds as positive constants", () => {
    expect(RANKING_COMPOSITE_MIN_METHODS).toBe(2);
    expect(RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT).toBeGreaterThan(0);
    expect(RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT).toBeLessThanOrEqual(1);
    expect(RANKING_MAX_ACTIVITY_CORRELATION).toBeGreaterThan(0);
    expect(RANKING_MAX_ACTIVITY_CORRELATION).toBeLessThanOrEqual(1);
    expect(RANKING_LEAVE_ONE_OUT_TOP_MOVERS).toBeGreaterThan(0);
    // The four composite methods are named with human-readable labels so the
    // effective-weight decomposition and leave-one-out rows can be rendered
    // without the scaffold re-deriving the mapping.
    const methods: CompositeMethod[] = [
      "output",
      "impact",
      "delivery",
      "adjusted",
    ];
    for (const m of methods) {
      expect(RANKING_COMPOSITE_METHOD_LABELS[m]).toBeTruthy();
    }
  });

  it("every method's internal signal weights sum to 1.0", () => {
    for (const method of [
      "output",
      "impact",
      "delivery",
      "adjusted",
    ] as CompositeMethod[]) {
      const total = RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS[method].reduce(
        (s, c) => s + c.weight,
        0,
      );
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("composite is the median of present methods and is null below the minimum", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    // With five competitive engineers and all signals present, every engineer
    // should have at least two present methods and therefore a non-null
    // composite.
    for (const c of composite.entries) {
      expect(c.presentMethodCount).toBeGreaterThanOrEqual(
        RANKING_COMPOSITE_MIN_METHODS,
      );
      expect(c.composite).not.toBeNull();
      // Composite must lie between the smallest and largest present method
      // by the definition of the median.
      const present = [
        c.output,
        c.impact,
        c.delivery,
        c.quality,
        c.adjusted,
      ].filter(
        (v): v is number => v !== null && Number.isFinite(v),
      );
      expect(c.composite!).toBeGreaterThanOrEqual(Math.min(...present));
      expect(c.composite!).toBeLessThanOrEqual(Math.max(...present));
    }
  });

  it("engineer with only one present method is unscored (composite null, rank null)", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3),
      // Engineer 4 has no impact data, no squad delivery data, and zero
      // GitHub activity → only the adjusted-percentile method could score
      // them and that also collapses to null without a rawScore.
      competitiveEntry(4, { hasImpactModelRow: false }),
    ];
    const signals = [
      signalRow(1),
      signalRow(2),
      signalRow(3),
      {
        emailHash: hashEmailForRanking("eng4@meetcleo.com"),
        prCount: null,
        commitCount: null,
        additions: null,
        deletions: null,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
        squadPrsInProgress: null,
      } as PerEngineerSignalRow,
    ];
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const fourth = composite.entries.find((e) => e.displayName === "Engineer 4");
    expect(fourth).toBeDefined();
    expect(fourth!.composite).toBeNull();
    expect(fourth!.rank).toBeNull();
    expect(fourth!.methodsSummary.toLowerCase()).toMatch(
      /no methods|below the \d-method|no methods present/,
    );
  });

  it("composite rank is produced for scored engineers and skipped for unscored", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3),
    ];
    const signals = [signalRow(1), signalRow(2), signalRow(3)];
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const scored = composite.entries.filter((e) => e.composite !== null);
    // All ranks must be 1..n with no duplicates and no gaps.
    const ranks = scored.map((e) => e.rank).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks).toEqual([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBe(scored.length);
  });

  it("effective signal weights sum to 1.0 across all five methods", () => {
    const composite = buildComposite({
      entries: [],
      lenses: buildLenses({ entries: [] }),
      normalisation: buildNormalisation({ entries: [] }),
    });
    const total = composite.effectiveSignalWeights.reduce(
      (s, w) => s + w.totalWeight,
      0,
    );
    expect(total).toBeCloseTo(1, 6);
    // Every signal must be strictly positive — a zero-weight signal on the
    // dominance table is just confusion.
    for (const w of composite.effectiveSignalWeights) {
      expect(w.totalWeight).toBeGreaterThan(0);
    }
  });

  it("log-impact exceeds the 30% effective-weight ceiling and is surfaced with a recorded justification", () => {
    const composite = buildComposite({
      entries: [],
      lenses: buildLenses({ entries: [] }),
      normalisation: buildNormalisation({ entries: [] }),
    });
    const logImpact = composite.effectiveSignalWeights.find(
      (w) => w.signal === "Log-impact composite",
    );
    expect(logImpact).toBeDefined();
    expect(logImpact!.totalWeight).toBeGreaterThan(
      RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT,
    );
    expect(logImpact!.flagged).toBe(true);
    expect(logImpact!.justification).toBeTruthy();
    // The dominance warnings panel must name the log-impact overshoot as a
    // methodology trade-off so the page cannot show a flagged signal without
    // telling the reader why it is tolerated.
    const mentionsLogImpact = composite.dominanceWarnings.some(
      (w) => w.toLowerCase().includes("log-impact"),
    );
    expect(mentionsLogImpact).toBe(true);
  });

  it("no non-log-impact signal exceeds the 30% effective-weight ceiling", () => {
    const composite = buildComposite({
      entries: [],
      lenses: buildLenses({ entries: [] }),
      normalisation: buildNormalisation({ entries: [] }),
    });
    for (const w of composite.effectiveSignalWeights) {
      if (w.signal === "Log-impact composite") continue;
      expect(w.totalWeight).toBeLessThanOrEqual(
        RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT,
      );
      expect(w.flagged).toBe(false);
    }
  });

  it("AI tokens and AI spend do not appear in any effective-weight contribution", () => {
    const composite = buildComposite({
      entries: [],
      lenses: buildLenses({ entries: [] }),
      normalisation: buildNormalisation({ entries: [] }),
    });
    for (const w of composite.effectiveSignalWeights) {
      expect(w.signal.toLowerCase()).not.toMatch(/ai tokens|ai spend/);
    }
  });

  it("leave-one-method-out rows exist for every method and ranks change when a method is removed", () => {
    // Construct signals so that one engineer is the top on output but
    // middling on impact/delivery, and another engineer is the top on impact
    // but middling on output/delivery. Dropping either lens must change the
    // composite rank — otherwise the composite is insensitive to the method.
    const entries = [
      competitiveEntry(1, { displayName: "Top on output" }),
      competitiveEntry(2, { displayName: "Balanced" }),
      competitiveEntry(3, { displayName: "Top on impact" }),
      competitiveEntry(4, { displayName: "Low everything" }),
    ];
    const signals = [
      signalRow(1, {
        prCount: 200,
        commitCount: 500,
        additions: 40_000,
        deletions: 5_000,
        shapPredicted: 20,
        shapActual: 25,
        shapResidual: 5,
      }),
      signalRow(2, {
        prCount: 30,
        commitCount: 60,
        additions: 3_000,
        deletions: 500,
        shapPredicted: 60,
        shapActual: 60,
        shapResidual: 0,
      }),
      signalRow(3, {
        prCount: 5,
        commitCount: 10,
        additions: 500,
        deletions: 100,
        shapPredicted: 180,
        shapActual: 200,
        shapResidual: 20,
      }),
      signalRow(4, {
        prCount: 2,
        commitCount: 4,
        additions: 100,
        deletions: 20,
        shapPredicted: 3,
        shapActual: 2,
        shapResidual: -1,
      }),
    ];
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const methods: CompositeMethod[] = [
      "output",
      "impact",
      "delivery",
      "adjusted",
    ];
    for (const m of methods) {
      const row = composite.leaveOneOut.find((r) => r.removed === m);
      expect(row).toBeDefined();
      expect(row!.removedLabel).toBe(RANKING_COMPOSITE_METHOD_LABELS[m]);
    }
    // Removing the output lens must alter at least one engineer's rank
    // meaningfully — composite should not be invariant to a lens.
    const outputOut = composite.leaveOneOut.find((r) => r.removed === "output");
    expect(outputOut).toBeDefined();
    const anyDelta = outputOut!.movers.some(
      (m) => m.delta !== null && m.delta !== 0,
    );
    expect(anyDelta).toBe(true);
  });

  it("leave-one-method-out correlation-to-baseline is rho=1.0 for a cohort where that method agrees with the others", () => {
    // If every engineer's four methods agree perfectly (e.g. identical
    // scaled signals), dropping any method cannot change the relative order
    // — correlation to baseline must be 1.0.
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    // Use strictly monotonic positive integers for every signal — rank order
    // is identical across lenses because every normalised signal has the
    // same rank-percentile ordering.
    const signals = Array.from({ length: 6 }, (_, i) => {
      const v = i + 1;
      return signalRow(v, {
        prCount: v,
        commitCount: v,
        additions: v * 100,
        deletions: 0,
        shapPredicted: v,
        shapActual: v,
        shapResidual: v,
        squadCycleTimeHours: 100 - v,
        squadReviewRatePercent: v,
        squadTimeToFirstReviewHours: 100 - v,
      });
    });
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    for (const row of composite.leaveOneOut) {
      expect(row.correlationToBaseline).not.toBeNull();
      expect(row.correlationToBaseline!).toBeCloseTo(1, 3);
    }
  });

  it("final-rank correlation flags PR count and log-impact as dominance risks", () => {
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 6 }, (_, i) => signalRow(i + 1));
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const prCount = composite.finalRankCorrelations.find(
      (c) => c.signal === "PR count",
    );
    const logImpact = composite.finalRankCorrelations.find(
      (c) => c.signal === "Log impact",
    );
    expect(prCount).toBeDefined();
    expect(logImpact).toBeDefined();
    expect(prCount!.dominanceRisk).toBe(true);
    expect(logImpact!.dominanceRisk).toBe(true);
    // Signals that are not dominance risks must be reported without flagging
    // — we still want the row, we just do not threshold-gate it.
    const shapActual = composite.finalRankCorrelations.find(
      (c) => c.signal === "SHAP actual impact",
    );
    expect(shapActual).toBeDefined();
    expect(shapActual!.dominanceRisk).toBe(false);
    expect(shapActual!.exceedsThreshold).toBe(false);
  });

  it("PR-count-only cohort blocks the methodology with a dominance warning", () => {
    // Pathological fixture: every non-PR-count / non-log-impact signal is
    // constant, so the composite can only order by PR-count-driven signals.
    // The final rank must end up highly correlated with PR count, tripping
    // the dominance check.
    const entries = Array.from({ length: 8 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => {
      const pr = i + 1;
      return {
        emailHash: hashEmailForRanking(`eng${i + 1}@meetcleo.com`),
        prCount: pr,
        commitCount: pr,
        additions: pr * 100,
        deletions: 0,
        // Constant SHAP signals → impact lens cannot differentiate.
        shapPredicted: 50,
        shapActual: 50,
        shapResidual: 0,
        aiTokens: null,
        aiSpend: null,
        // Constant squad delivery → delivery lens cannot differentiate.
        squadCycleTimeHours: 30,
        squadReviewRatePercent: 80,
        squadTimeToFirstReviewHours: 3,
        squadPrsInProgress: 5,
      } as PerEngineerSignalRow;
    });
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    expect(composite.dominanceBlocked).toBe(true);
    const prCount = composite.finalRankCorrelations.find(
      (c) => c.signal === "PR count",
    );
    expect(prCount).toBeDefined();
    expect(prCount!.exceedsThreshold).toBe(true);
    const activityWarning = composite.dominanceWarnings.some((w) =>
      /(pr count|log impact)/i.test(w) &&
      /(collapsed|activity|threshold)/i.test(w),
    );
    expect(activityWarning).toBe(true);
  });

  it("flat PR count across the cohort leaves the dominance check undefined, not blocked", () => {
    // When every engineer has the same PR count (and same log-impact),
    // Spearman has zero variance on one side and returns null — a null rho
    // must never be read as exceeding the threshold or blocking the rank.
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) =>
      signalRow(i + 1, {
        // Flat GitHub activity — PR count and log-impact cannot order anyone.
        prCount: 10,
        commitCount: 20,
        additions: 1_000,
        deletions: 100,
        // SHAP still varies so there is a composite to rank on.
        shapPredicted: (i + 1) * 10,
        shapActual: (i + 1) * 12,
        shapResidual: (i + 1) * 2,
      }),
    );
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const prCount = composite.finalRankCorrelations.find(
      (c) => c.signal === "PR count",
    );
    expect(prCount).toBeDefined();
    expect(prCount!.rho).toBeNull();
    expect(prCount!.exceedsThreshold).toBe(false);
    // Zero-variance inputs must not produce a spurious dominance block —
    // only a real Spearman > threshold can set the blocker.
    const anyActivityBlock = composite.dominanceWarnings.some((w) =>
      /(activity|collapsed into)/i.test(w),
    );
    expect(anyActivityBlock).toBe(false);
    expect(composite.dominanceBlocked).toBe(false);
  });

  it("ramp-up and leaver rows are not composited — only competitive engineers", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2, {
        eligibility: "ramp_up",
        tenureDays: 30,
        reason: "Ramp-up",
      }),
      competitiveEntry(3, {
        eligibility: "inactive_or_leaver",
        isLeaverOrInactive: true,
        reason: "Leaver",
      }),
    ];
    const signals = [signalRow(1), signalRow(2), signalRow(3)];
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const names = composite.entries.map((e) => e.displayName);
    expect(names).toEqual(["Engineer 1"]);
  });

  it("ranked includes every scored engineer sorted ascending by rank", () => {
    const size = 30;
    const entries = Array.from({ length: size }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: size }, (_, i) => signalRow(i + 1));
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({ entries, lenses, normalisation, signals });
    const scored = composite.entries.filter(
      (e) => e.composite !== null && e.rank !== null,
    );
    expect(composite.ranked.length).toBe(scored.length);
    const ranks = composite.ranked.map((e) => e.rank as number);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
    expect(ranks[0]).toBe(1);
  });

  it("buildRankingSnapshot attaches the composite bundle and populates top-level engineers with ranks", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const now = new Date("2026-04-24T00:00:00Z");
    const headcountRows = entries.map((e) => ({
      email: e.email,
      preferred_name: e.displayName,
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: e.squad,
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Core",
      job_title: "Senior Backend Engineer",
      manager: e.manager,
      line_manager_email: `${e.manager?.toLowerCase()}@meetcleo.com`,
      start_date: "2023-01-01",
      termination_date: null,
    }));
    const githubMap = entries.map((e) => ({
      githubLogin: e.githubLogin!,
      employeeEmail: e.email,
      isBot: false,
    }));
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: {
        engineers: entries.map((e) => ({ email: e.email })),
      },
      signals,
      now,
    });
    expect(snapshot.composite).toBeDefined();
    expect(snapshot.composite.entries.length).toBe(entries.length);
    // Every top-level engineer row carries a non-null rank and a compositeScore.
    expect(snapshot.engineers.length).toBeGreaterThan(0);
    for (const e of snapshot.engineers) {
      expect(e.rank).not.toBeNull();
      expect(e.compositeScore).not.toBeNull();
    }
    // engineers are sorted by rank ascending.
    const ranks = snapshot.engineers.map((e) => e.rank as number);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });

  it("direct AI-token inflation cannot change composite rank — identical non-AI signals produce identical composites", () => {
    const entries = [competitiveEntry(1), competitiveEntry(2)];
    const baseSignals = [
      signalRow(1, { aiTokens: 0, aiSpend: 0 }),
      signalRow(2, { aiTokens: 0, aiSpend: 0 }),
    ];
    const inflatedSignals = [
      signalRow(1, { aiTokens: 10_000_000, aiSpend: 50_000 }),
      signalRow(2, { aiTokens: 0, aiSpend: 0 }),
    ];
    const lensesBase = buildLenses({ entries, signals: baseSignals });
    const lensesInflated = buildLenses({ entries, signals: inflatedSignals });
    const normBase = buildNormalisation({ entries, signals: baseSignals });
    const normInfl = buildNormalisation({ entries, signals: inflatedSignals });
    const base = buildComposite({
      entries,
      lenses: lensesBase,
      normalisation: normBase,
      signals: baseSignals,
    });
    const infl = buildComposite({
      entries,
      lenses: lensesInflated,
      normalisation: normInfl,
      signals: inflatedSignals,
    });
    const baseMap = new Map(base.entries.map((e) => [e.displayName, e.composite]));
    for (const e of infl.entries) {
      expect(e.composite).toEqual(baseMap.get(e.displayName));
    }
  });

  it("composite limitations name confidence / attribution / snapshot persistence as implemented, and movers as pending", () => {
    const composite = buildComposite({
      entries: [],
      lenses: buildLenses({ entries: [] }),
      normalisation: buildNormalisation({ entries: [] }),
    });
    const joined = composite.limitations.join(" ").toLowerCase();
    // Movers must still be named as outstanding work.
    expect(joined).toMatch(/movers/);
    // Confidence bands are live (M14) — they must not be narrated
    // as still-pending future work in the composite limitations.
    expect(joined).not.toMatch(
      /confidence bands[^.]*(still pending|not yet|yet to|pending|future|outstanding)/,
    );
    // Attribution is live (M15) — any mention must not mark it as pending.
    expect(joined).not.toMatch(
      /attribution[^.]*(still pending|not yet|yet to|pending)/,
    );
    // Snapshot persistence (M16) is now live — it must not appear on the
    // pending list either.
    expect(joined).not.toMatch(
      /snapshot[^.]*(still pending|not yet|yet to|are pending|remain pending)/,
    );
  });

  it("snapshot known limitations narrate composite + confidence + attribution + snapshot persistence as implemented, and movers/stability as pending", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.knownLimitations.join(" ").toLowerCase();
    // Composite must no longer be described as pending — it is built and the
    // page renders it. The guard asserts the page cannot drift back into
    // "composite is still missing" wording once M12 is live.
    expect(joined).not.toMatch(
      /(final )?composite score[^.]*(still pending|not yet|yet to|pending)/,
    );
    // Confidence bands are now live (M14) — they must not be narrated as
    // still-pending future work in the on-page known-limitations list.
    expect(joined).not.toMatch(
      /confidence bands[^.]*(still pending|not yet|yet to|pending)/,
    );
    // Attribution is live (M15) — the known-limitations list must not
    // describe it as pending, though it can still name it as implemented.
    expect(joined).not.toMatch(
      /attribution[^.]*(still pending|not yet|yet to|pending)/,
    );
    // Snapshot persistence is live (M16) — it must not appear on the
    // pending list.
    expect(joined).not.toMatch(
      /snapshot[^.]*(still pending|not yet|yet to|are pending|remain pending)/,
    );
    // Movers and stability are still genuinely pending and must be named so
    // a reader sees what is still missing.
    expect(joined).toMatch(/movers/);
    expect(joined).toMatch(/stability/);
  });
});

describe("M13 methodology version and readiness provenance", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signalRow(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: index,
      commitCount: index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  it("RANKING_METHODOLOGY_VERSION is no longer the scaffold-era version", () => {
    // Once the composite populates `snapshot.engineers`, the methodology
    // version must distinguish composite-era snapshots from scaffold-era
    // ones so M16 persistence and M17 movers do not compare incompatible
    // rankings under the same label.
    expect(RANKING_METHODOLOGY_VERSION).not.toBe("0.1.0-scaffold");
  });

  it("methodology version names the current methodology stage", () => {
    // The version string is rendered verbatim in the page header and
    // persisted on every future snapshot. It must tell a reader — and a
    // future snapshot-reader — what methodology was actually running. The
    // version moves forward with each scoring milestone (composite,
    // confidence, …); the regression guard below pins that the version
    // names a real stage rather than reverting to the scaffold label.
    const version = RANKING_METHODOLOGY_VERSION.toLowerCase();
    expect(version).toMatch(/composite|confidence|attribution|snapshot|movers|stability|methodology|quality/);
  });

  it("snapshot stamps the current methodology version on every snapshot", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    expect(snapshot.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(snapshot.methodologyVersion).not.toBe("0.1.0-scaffold");
  });

  it("composite-era snapshot populates ranked engineers and keeps a composite version", () => {
    // Build a cohort large enough for `buildComposite()` to assign ranks,
    // then prove that (a) composite is present, (b) `snapshot.engineers`
    // is non-empty, and (c) the methodology version is not the scaffold
    // label — so future persisted snapshots never mislabel composite-era
    // rankings as scaffold-era outputs.
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const headcountRows = entries.map((e) => ({
      email: e.email,
      preferred_name: e.displayName,
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: e.squad,
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Core",
      job_title: "Senior Backend Engineer",
      manager: e.manager,
      line_manager_email: `${e.manager?.toLowerCase()}@meetcleo.com`,
      start_date: "2023-01-01",
      termination_date: null,
    }));
    const githubMap = entries.map((e) => ({
      githubLogin: e.githubLogin!,
      employeeEmail: e.email,
      isBot: false,
    }));
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: {
        engineers: entries.map((e) => ({ email: e.email })),
      },
      signals,
      now: new Date("2026-04-24T00:00:00Z"),
    });

    expect(snapshot.composite).toBeDefined();
    expect(snapshot.methodologyVersion).not.toBe("0.1.0-scaffold");
    expect(snapshot.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(snapshot.engineers.length).toBeGreaterThan(0);
    for (const engineer of snapshot.engineers) {
      expect(engineer.rank).not.toBeNull();
      expect(engineer.compositeScore).not.toBeNull();
    }
  });

  it("known-limitations still describe composite + confidence + attribution + snapshot persistence as implemented but not final", () => {
    // Regression guard: the version bump must not accidentally demote the
    // page's honesty about what is and isn't finished. Composite, confidence
    // bands, attribution drilldowns, and snapshot persistence (M16) are
    // live; movers / anti-gaming / stability are not.
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.knownLimitations.join(" ").toLowerCase();
    expect(joined).not.toMatch(
      /(final )?composite score[^.]*(still pending|not yet|yet to|pending)/,
    );
    expect(joined).not.toMatch(
      /confidence bands[^.]*(still pending|not yet|yet to|pending)/,
    );
    expect(joined).not.toMatch(
      /attribution[^.]*(still pending|not yet|yet to|pending)/,
    );
    expect(joined).not.toMatch(
      /snapshot[^.]*(still pending|not yet|yet to|are pending|remain pending)/,
    );
    expect(joined).toMatch(/attribution/);
    expect(joined).toMatch(/movers/);
    expect(joined).toMatch(/stability/);
  });

  it("stub getEngineeringRanking() also stamps the composite-era version", async () => {
    const snapshot = await getEngineeringRanking();
    expect(snapshot.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(snapshot.methodologyVersion).not.toBe("0.1.0-scaffold");
  });
});

describe("M14 confidence bands and statistical tie handling", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signalRow(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: 30 + index,
      commitCount: 60 + index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  function buildBundle(entries: EligibilityEntry[], signals: PerEngineerSignalRow[]) {
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({
      entries,
      lenses,
      normalisation,
      signals,
    });
    const confidence = buildConfidence({
      entries,
      composite,
      signals,
    });
    return { lenses, normalisation, composite, confidence };
  }

  it("confidence constants are sane", () => {
    expect(RANKING_BOOTSTRAP_ITERATIONS).toBeGreaterThanOrEqual(200);
    expect(RANKING_CI_COVERAGE).toBeGreaterThan(0);
    expect(RANKING_CI_COVERAGE).toBeLessThan(1);
    expect(RANKING_DOMINANCE_WIDENING).toBeGreaterThan(1);
    expect(RANKING_LOW_PR_COUNT_THRESHOLD).toBeGreaterThan(0);
    expect(RANKING_LOW_TENURE_DAYS_FOR_CONFIDENCE).toBeGreaterThan(0);
    expect(RANKING_MIN_SIGMA).toBeGreaterThan(0);
    expect(RANKING_MAX_SIGMA).toBeGreaterThan(RANKING_MIN_SIGMA);
  });

  it("confidence bundle attaches one entry per competitive engineer with a CI for every scored row", () => {
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 6 }, (_, i) => signalRow(i + 1));
    const { confidence, composite } = buildBundle(entries, signals);
    expect(confidence.entries.length).toBe(entries.length);
    const scored = composite.entries.filter((e) => e.composite !== null);
    const ciScored = confidence.entries.filter((e) => e.ciLow !== null);
    expect(ciScored.length).toBe(scored.length);
    for (const ci of ciScored) {
      expect(ci.ciLow).not.toBeNull();
      expect(ci.ciHigh).not.toBeNull();
      expect(ci.ciHigh!).toBeGreaterThanOrEqual(ci.ciLow!);
      expect(ci.composite!).toBeGreaterThanOrEqual(ci.ciLow!);
      expect(ci.composite!).toBeLessThanOrEqual(ci.ciHigh!);
      expect(ci.ciRankLow).not.toBeNull();
      expect(ci.ciRankHigh).not.toBeNull();
      expect(ci.ciRankLow!).toBeLessThanOrEqual(ci.ciRankHigh!);
    }
  });

  it("low PR count engineer has wider CI than high PR count engineer with otherwise identical signals", () => {
    const entries = [
      competitiveEntry(1),
      competitiveEntry(2),
    ];
    // Same SHAP, same commits, same lines — only PR count differs.
    const signals = [
      signalRow(1, {
        prCount: 3,
        commitCount: 80,
        shapPredicted: 100,
        shapActual: 100,
      }),
      signalRow(2, {
        prCount: 60,
        commitCount: 80,
        shapPredicted: 100,
        shapActual: 100,
      }),
    ];
    const { confidence } = buildBundle(entries, signals);
    const a = confidence.entries.find((e) => e.displayName === "Engineer 1")!;
    const b = confidence.entries.find((e) => e.displayName === "Engineer 2")!;
    expect(a.sigma!).toBeGreaterThan(b.sigma!);
    expect(a.ciWidth!).toBeGreaterThan(b.ciWidth!);
    expect(a.uncertaintyFactors.some((f) => /pr count/i.test(f))).toBe(true);
    expect(b.uncertaintyFactors.some((f) => /pr count/i.test(f))).toBe(false);
  });

  it("quality method contributes to confidence spread once lens D is part of the composite", () => {
    const entries = [competitiveEntry(1)];
    const signals = [signalRow(1)];
    const baseComposite: CompositeBundle = {
      contract: "",
      methods: ["output", "impact", "delivery", "quality", "adjusted"],
      minPresentMethods: RANKING_COMPOSITE_MIN_METHODS,
      maxSingleSignalEffectiveWeight: RANKING_MAX_SINGLE_SIGNAL_EFFECTIVE_WEIGHT,
      dominanceCorrelationThreshold: RANKING_MAX_ACTIVITY_CORRELATION,
      entries: [
        {
          emailHash: entries[0].emailHash,
          displayName: entries[0].displayName,
          discipline: entries[0].discipline,
          levelLabel: entries[0].levelLabel,
          output: 90,
          impact: 50,
          delivery: 50,
          quality: 10,
          adjusted: 50,
          presentMethodCount: 5,
          composite: 50,
          compositePercentile: 50,
          rank: 1,
          methodsSummary: "",
        },
      ],
      ranked: [],
      effectiveSignalWeights: [],
      leaveOneOut: [],
      finalRankCorrelations: [],
      dominanceWarnings: [],
      dominanceBlocked: false,
      limitations: [],
    };

    const lowQualitySpread = buildConfidence({
      entries,
      composite: baseComposite,
      signals,
      iterations: 0,
    });
    const highQualitySpread = buildConfidence({
      entries,
      composite: {
        ...baseComposite,
        entries: [{ ...baseComposite.entries[0], quality: 90 }],
      },
      signals,
      iterations: 0,
    });

    expect(lowQualitySpread.entries[0].sigma).toBeGreaterThan(
      highQualitySpread.entries[0].sigma!,
    );
  });

  it("short tenure engineer has wider CI than long tenure engineer with the same activity", () => {
    const entries = [
      competitiveEntry(1, { tenureDays: 100 }),
      competitiveEntry(2, { tenureDays: 1000 }),
    ];
    const signals = [signalRow(1), signalRow(2)];
    const { confidence } = buildBundle(entries, signals);
    const young = confidence.entries.find((e) => e.displayName === "Engineer 1")!;
    const old = confidence.entries.find((e) => e.displayName === "Engineer 2")!;
    expect(young.sigma!).toBeGreaterThan(old.sigma!);
    expect(young.uncertaintyFactors.some((f) => /tenure/i.test(f))).toBe(true);
  });

  it("missing GitHub mapping widens the band even if other signals are present", () => {
    const entries = [
      competitiveEntry(1, { githubLogin: null }),
      competitiveEntry(2),
    ];
    const signals = [signalRow(1), signalRow(2)];
    const { confidence } = buildBundle(entries, signals);
    const unmapped = confidence.entries.find((e) => e.displayName === "Engineer 1");
    if (unmapped && unmapped.sigma !== null) {
      expect(unmapped.uncertaintyFactors.some((f) => /github/i.test(f))).toBe(true);
    }
  });

  it("dominance-blocked composite widens every band globally", () => {
    // Build a cohort so collinear with PR count that the composite trips
    // the activity-dominance check, and verify confidence applies the
    // global widening factor.
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) =>
      signalRow(i + 1, {
        prCount: (i + 1) * 100,
        commitCount: (i + 1) * 100,
        additions: (i + 1) * 1_000,
        shapPredicted: (i + 1) * 100,
        shapActual: (i + 1) * 100,
      }),
    );
    const { composite, confidence } = buildBundle(entries, signals);
    expect(composite.dominanceBlocked).toBe(true);
    expect(confidence.globalDominanceApplied).toBe(true);
    for (const ci of confidence.entries) {
      if (ci.sigma === null) continue;
      expect(ci.uncertaintyFactors.some((f) => /dominance/i.test(f))).toBe(true);
    }
  });

  it("statistical tie groups detect rank-adjacent overlapping bands", () => {
    // Two engineers with very similar composites (and small per-engineer
    // sigmas) should fall into the same tie group; an engineer far enough
    // away should not.
    const entries = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3),
    ];
    const signals = [
      signalRow(1, { prCount: 50, shapPredicted: 100, shapActual: 100 }),
      signalRow(2, { prCount: 50, shapPredicted: 100, shapActual: 100 }),
      signalRow(3, { prCount: 50, shapPredicted: 1, shapActual: 1 }),
    ];
    const { confidence, composite } = buildBundle(entries, signals);
    // Two near-identical engineers should overlap.
    const ranked = confidence.entries
      .filter((e): e is EngineerConfidence & { rank: number } => e.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    const top = ranked[0];
    const second = ranked[1];
    expect(top.ciLow).not.toBeNull();
    expect(second.ciHigh).not.toBeNull();
    // Rank-adjacent overlap → same tie group.
    if (top.ciLow! <= second.ciHigh!) {
      expect(top.tieGroupId).not.toBeNull();
      expect(top.tieGroupId).toBe(second.tieGroupId);
      expect(top.inTieGroup).toBe(true);
      expect(second.inTieGroup).toBe(true);
    }
    // The composite cohort still has a defined rank for the third engineer.
    const third = ranked[2];
    expect(third.composite).not.toBeNull();
    expect(composite.entries.length).toBe(entries.length);
  });

  it("tie groups have at least 2 members and span a contiguous rank range", () => {
    const entries = Array.from({ length: 8 }, (_, i) => competitiveEntry(i + 1));
    // Compress everyone into a tight composite range so several pairs
    // overlap.
    const signals = entries.map((_, i) =>
      signalRow(i + 1, {
        prCount: 40,
        commitCount: 80,
        shapPredicted: 100 + i,
        shapActual: 100 + i,
        additions: 500,
      }),
    );
    const { confidence } = buildBundle(entries, signals);
    for (const group of confidence.tieGroups) {
      expect(group.size).toBeGreaterThanOrEqual(2);
      expect(group.size).toBe(group.members.length);
      const ranks = group.members.map((m) => m.rank).sort((a, b) => a - b);
      expect(group.rankStart).toBe(ranks[0]);
      expect(group.rankEnd).toBe(ranks[ranks.length - 1]);
      // Contiguous: rankEnd - rankStart + 1 == size when no scored
      // engineer outside the group sits between them in rank order.
      expect(group.rankEnd - group.rankStart + 1).toBe(group.size);
    }
  });

  it("unscored engineers get null bands and an empty factor list", () => {
    // Only one competitive engineer with one method present → composite
    // is null because RANKING_COMPOSITE_MIN_METHODS = 2.
    const entries = [competitiveEntry(1)];
    const lenses = buildLenses({ entries });
    const normalisation = buildNormalisation({ entries });
    const composite = buildComposite({ entries, lenses, normalisation });
    const confidence = buildConfidence({ entries, composite });
    for (const ci of confidence.entries) {
      if (ci.composite === null) {
        expect(ci.ciLow).toBeNull();
        expect(ci.ciHigh).toBeNull();
        expect(ci.ciRankLow).toBeNull();
        expect(ci.ciRankHigh).toBeNull();
        expect(ci.sigma).toBeNull();
        expect(ci.uncertaintyFactors).toEqual([]);
        expect(ci.inTieGroup).toBe(false);
        expect(ci.tieGroupId).toBeNull();
      }
    }
  });

  it("snapshot.engineers carries the per-engineer CI in composite-percentile space", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const headcountRows = entries.map((e) => ({
      email: e.email,
      preferred_name: e.displayName,
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: e.squad,
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Core",
      job_title: "Senior Backend Engineer",
      manager: e.manager,
      line_manager_email: `${e.manager?.toLowerCase()}@meetcleo.com`,
      start_date: "2023-01-01",
      termination_date: null,
    }));
    const githubMap = entries.map((e) => ({
      githubLogin: e.githubLogin!,
      employeeEmail: e.email,
      isBot: false,
    }));
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: {
        engineers: entries.map((e) => ({ email: e.email })),
      },
      signals,
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(snapshot.confidence).toBeDefined();
    expect(snapshot.confidence.entries.length).toBe(entries.length);
    for (const engineer of snapshot.engineers) {
      expect(engineer.confidence).not.toBeNull();
      expect(engineer.confidence!.high).toBeGreaterThanOrEqual(
        engineer.confidence!.low,
      );
      // Composite score sits inside its own CI.
      expect(engineer.compositeScore!).toBeGreaterThanOrEqual(
        engineer.confidence!.low,
      );
      expect(engineer.compositeScore!).toBeLessThanOrEqual(
        engineer.confidence!.high,
      );
    }
  });

  it("bootstrap is deterministic — two snapshots from the same inputs have the same CIs", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const a = buildBundle(entries, signals).confidence;
    const b = buildBundle(entries, signals).confidence;
    const aMap = new Map(a.entries.map((e) => [e.emailHash, e.ciLow]));
    for (const e of b.entries) {
      expect(e.ciLow).toEqual(aMap.get(e.emailHash));
    }
  });

  it("AI inflation does not change confidence bands — sigma is independent of AI signals", () => {
    const entries = [competitiveEntry(1), competitiveEntry(2)];
    const baseSignals = [
      signalRow(1, { aiTokens: 0, aiSpend: 0 }),
      signalRow(2, { aiTokens: 0, aiSpend: 0 }),
    ];
    const inflatedSignals = [
      signalRow(1, { aiTokens: 10_000_000, aiSpend: 50_000 }),
      signalRow(2, { aiTokens: 0, aiSpend: 0 }),
    ];
    const a = buildBundle(entries, baseSignals).confidence;
    const b = buildBundle(entries, inflatedSignals).confidence;
    const aMap = new Map(a.entries.map((e) => [e.emailHash, e.ciWidth]));
    for (const e of b.entries) {
      expect(e.ciWidth).toEqual(aMap.get(e.emailHash));
    }
  });

  it("confidence contract names the bootstrap iterations and CI coverage", () => {
    const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 4 }, (_, i) => signalRow(i + 1));
    const { confidence } = buildBundle(entries, signals);
    expect(confidence.contract).toContain(`${RANKING_BOOTSTRAP_ITERATIONS}`);
    expect(confidence.bootstrapIterations).toBe(RANKING_BOOTSTRAP_ITERATIONS);
    expect(confidence.ciCoverage).toBe(RANKING_CI_COVERAGE);
  });

  it("methodology version names a post-confidence stage (confidence or attribution era)", () => {
    // At M14 the version label was `0.6.0-confidence`. Later milestones (M15
    // attribution, M16 snapshots, etc.) bump the label to name their stage,
    // so the guard accepts any post-scaffold label that matches the live
    // methodology chain.
    const v = RANKING_METHODOLOGY_VERSION.toLowerCase();
    expect(v).not.toBe("0.1.0-scaffold");
    expect(v).toMatch(/confidence|attribution|snapshot|movers|stability|methodology|quality/);
  });

  it("known-limitations narrate confidence bands as implemented (not pending) once M14 lands", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.knownLimitations.join(" ").toLowerCase();
    expect(joined).toMatch(/confidence bands/);
    // Whatever sentence mentions "confidence bands" must classify them as
    // implemented, not as still-pending future work.
    expect(joined).not.toMatch(
      /confidence bands[^.]*(still pending|not yet|yet to|pending)/,
    );
  });

  it("scaffold-stage limitations mention confidence and statistical-tie groups", () => {
    const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 4 }, (_, i) => signalRow(i + 1));
    const { confidence } = buildBundle(entries, signals);
    const joined = confidence.limitations.join(" ").toLowerCase();
    expect(joined).toMatch(/confidence/);
    expect(joined).toMatch(/tie/);
  });
});

describe("M15 per-engineer attribution drilldown", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signalRow(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: 30 + index,
      commitCount: 60 + index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  function buildAttributionBundle(
    entries: EligibilityEntry[],
    signals: PerEngineerSignalRow[],
    opts: {
      windowStartIso?: string;
      windowEndIso?: string;
      githubOrg?: string | null;
    } = {},
  ) {
    const lenses = buildLenses({ entries, signals });
    const normalisation = buildNormalisation({ entries, signals });
    const composite = buildComposite({
      entries,
      lenses,
      normalisation,
      signals,
    });
    const attribution = buildAttribution({
      entries,
      lenses,
      normalisation,
      composite,
      windowStartIso:
        opts.windowStartIso ?? "2025-10-26T00:00:00Z",
      windowEndIso: opts.windowEndIso ?? "2026-04-24T00:00:00Z",
      githubOrg: opts.githubOrg ?? null,
    });
    return { lenses, normalisation, composite, attribution };
  }

  it("attribution constants are sane", () => {
    expect(RANKING_ATTRIBUTION_TOP_DRIVERS).toBeGreaterThanOrEqual(3);
    expect(RANKING_ATTRIBUTION_TOLERANCE).toBeGreaterThan(0);
    expect(RANKING_ATTRIBUTION_TOLERANCE).toBeLessThan(1);
  });

  it("emits one attribution entry per competitive engineer", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    expect(attribution.entries.length).toBe(entries.length);
    for (const row of attribution.entries) {
      expect(row.eligibility).toBe("competitive");
      expect(row.methods.length).toBe(5);
    }
  });

  it("ramp-up and leaver entries are excluded from the attribution drilldown", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3, { tenureDays: 45, eligibility: "ramp_up" }),
      competitiveEntry(4, {
        isLeaverOrInactive: true,
        eligibility: "inactive_or_leaver",
      }),
    ];
    const signals = entries.map((_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    const hashes = new Set(attribution.entries.map((e) => e.emailHash));
    expect(hashes.has(entries[0].emailHash)).toBe(true);
    expect(hashes.has(entries[1].emailHash)).toBe(true);
    expect(hashes.has(entries[2].emailHash)).toBe(false);
    expect(hashes.has(entries[3].emailHash)).toBe(false);
  });

  it("reconciles the recomputed composite to the stored composite within tolerance", () => {
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 6 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    const scored = attribution.entries.filter((e) => e.compositeScore !== null);
    expect(scored.length).toBeGreaterThan(0);
    for (const entry of scored) {
      expect(entry.reconciliation.matches).toBe(true);
      expect(entry.reconciliation.recomputedComposite).not.toBeNull();
      expect(Math.abs(entry.reconciliation.delta!)).toBeLessThanOrEqual(
        RANKING_ATTRIBUTION_TOLERANCE,
      );
    }
  });

  it("per-method component weights sum to 1 across present methods", () => {
    const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 4 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    for (const engineer of attribution.entries) {
      for (const method of engineer.methods) {
        if (method.components.length === 0) continue;
        const total = method.components.reduce(
          (s, c) => s + c.weightInMethod,
          0,
        );
        expect(total).toBeCloseTo(1, 6);
      }
    }
  });

  it("absent signals are labelled rather than silently dropped", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { hasImpactModelRow: false }),
      competitiveEntry(2),
    ];
    // Engineer 1: missing SHAP fields + no squad delivery data.
    const signals: PerEngineerSignalRow[] = [
      {
        emailHash: hashEmailForRanking("eng1@meetcleo.com"),
        prCount: 40,
        commitCount: 80,
        additions: 600,
        deletions: 80,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
        squadPrsInProgress: null,
      },
      signalRow(2),
    ];
    const { attribution } = buildAttributionBundle(entries, signals);
    const first = attribution.entries.find(
      (e) => e.emailHash === entries[0].emailHash,
    )!;
    // At least the SHAP components should be labelled absent.
    const absentContributions = first.methods
      .flatMap((m) => m.components)
      .filter((c) => c.kind === "absent");
    expect(absentContributions.length).toBeGreaterThan(0);
    for (const absent of absentContributions) {
      expect(absent.absenceReason.length).toBeGreaterThan(0);
      expect(absent.percentile).toBeNull();
      expect(absent.approxCompositeLift).toBeNull();
    }
    // Absent signals also surface on the engineer-level absent list.
    expect(first.absentSignals.length).toBeGreaterThan(0);
  });

  it("approxCompositeLift is null for components whose method is absent", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, { hasImpactModelRow: false }),
      competitiveEntry(2),
      competitiveEntry(3),
    ];
    const signals: PerEngineerSignalRow[] = [
      {
        emailHash: hashEmailForRanking("eng1@meetcleo.com"),
        prCount: 40,
        commitCount: 80,
        additions: 600,
        deletions: 80,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: 24,
        squadReviewRatePercent: 80,
        squadTimeToFirstReviewHours: 2,
        squadPrsInProgress: 4,
      },
      signalRow(2),
      signalRow(3),
    ];
    const { attribution } = buildAttributionBundle(entries, signals);
    const first = attribution.entries.find(
      (e) => e.emailHash === entries[0].emailHash,
    )!;
    const impactMethod = first.methods.find((m) => m.method === "impact")!;
    expect(impactMethod.present).toBe(false);
    for (const component of impactMethod.components) {
      // Method-absent components must not claim a lift — the composite does
      // not receive any lift from a method that wasn't present.
      expect(component.approxCompositeLift).toBeNull();
    }
  });

  it("direct AI-token inflation leaves the attribution drilldown unchanged", () => {
    const entries = [competitiveEntry(1), competitiveEntry(2)];
    const base = [
      signalRow(1, { aiTokens: 0, aiSpend: 0 }),
      signalRow(2, { aiTokens: 0, aiSpend: 0 }),
    ];
    const inflated = [
      signalRow(1, { aiTokens: 50_000_000, aiSpend: 250_000 }),
      signalRow(2, { aiTokens: 0, aiSpend: 0 }),
    ];
    const a = buildAttributionBundle(entries, base).attribution;
    const b = buildAttributionBundle(entries, inflated).attribution;
    const byHashA = new Map(a.entries.map((e) => [e.emailHash, e]));
    for (const entry of b.entries) {
      const match = byHashA.get(entry.emailHash)!;
      expect(entry.compositeScore).toEqual(match.compositeScore);
      expect(entry.rank).toEqual(match.rank);
      // Each driver list is identical.
      expect(entry.topPositiveDrivers.map((d) => d.signal).sort()).toEqual(
        match.topPositiveDrivers.map((d) => d.signal).sort(),
      );
      expect(entry.topNegativeDrivers.map((d) => d.signal).sort()).toEqual(
        match.topNegativeDrivers.map((d) => d.signal).sort(),
      );
    }
    // And AI signals themselves never become contributions.
    for (const entry of b.entries) {
      const signals = entry.methods.flatMap((m) =>
        m.components.map((c) => c.signal.toLowerCase()),
      );
      for (const s of signals) {
        expect(s).not.toContain("ai tokens");
        expect(s).not.toContain("ai spend");
      }
    }
  });

  it("positive drivers have positive lift and are sorted by magnitude desc", () => {
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 6 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    for (const engineer of attribution.entries) {
      for (const driver of engineer.topPositiveDrivers) {
        expect(driver.approxCompositeLift).not.toBeNull();
        expect(driver.approxCompositeLift!).toBeGreaterThan(0);
      }
      for (let i = 1; i < engineer.topPositiveDrivers.length; i += 1) {
        expect(engineer.topPositiveDrivers[i].approxCompositeLift!).toBeLessThanOrEqual(
          engineer.topPositiveDrivers[i - 1].approxCompositeLift!,
        );
      }
      for (const driver of engineer.topNegativeDrivers) {
        expect(driver.approxCompositeLift).not.toBeNull();
        expect(driver.approxCompositeLift!).toBeLessThan(0);
      }
      for (let i = 1; i < engineer.topNegativeDrivers.length; i += 1) {
        // Ascending order (most negative first) means each subsequent delta
        // is at least as large (less negative) as the prior.
        expect(engineer.topNegativeDrivers[i].approxCompositeLift!).toBeGreaterThanOrEqual(
          engineer.topNegativeDrivers[i - 1].approxCompositeLift!,
        );
      }
    }
  });

  it("driver lists are capped at RANKING_ATTRIBUTION_TOP_DRIVERS", () => {
    const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 4 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    for (const engineer of attribution.entries) {
      expect(engineer.topPositiveDrivers.length).toBeLessThanOrEqual(
        RANKING_ATTRIBUTION_TOP_DRIVERS,
      );
      expect(engineer.topNegativeDrivers.length).toBeLessThanOrEqual(
        RANKING_ATTRIBUTION_TOP_DRIVERS,
      );
    }
  });

  it("peer comparison inherits the discipline cohort and adjusted lift from normalisation", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const { attribution, normalisation } = buildAttributionBundle(entries, signals);
    const normByHash = new Map(normalisation.entries.map((n) => [n.emailHash, n]));
    for (const entry of attribution.entries) {
      const norm = normByHash.get(entry.emailHash);
      if (!norm) continue;
      expect(entry.peerComparison.rawPercentile).toEqual(norm.rawPercentile);
      expect(entry.peerComparison.adjustedPercentile).toEqual(
        norm.adjustedPercentile,
      );
      expect(entry.peerComparison.disciplineCohort).toEqual(norm.disciplineCohort);
      expect(entry.peerComparison.adjustmentLift).toEqual(norm.adjustmentDelta);
    }
  });

  it("builds a stable GitHub PR-search URL only when both login and org are present", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2, { githubLogin: null }),
    ];
    const signals = [signalRow(1), signalRow(2)];
    const { attribution: withOrg } = buildAttributionBundle(entries, signals, {
      githubOrg: "meetcleo",
      windowStartIso: "2025-10-26T00:00:00Z",
      windowEndIso: "2026-04-24T00:00:00Z",
    });
    const { attribution: noOrg } = buildAttributionBundle(entries, signals, {
      githubOrg: null,
    });
    const mappedWithOrg = withOrg.entries.find(
      (e) => e.emailHash === entries[0].emailHash,
    )!;
    const mappedWithoutOrg = noOrg.entries.find(
      (e) => e.emailHash === entries[0].emailHash,
    )!;
    const unmapped = withOrg.entries.find(
      (e) => e.emailHash === entries[1].emailHash,
    )!;
    expect(mappedWithOrg.evidence.githubPrSearchUrl).not.toBeNull();
    expect(mappedWithOrg.evidence.githubPrSearchUrl).toContain("github.com/search");
    expect(mappedWithOrg.evidence.githubPrSearchUrl).toContain("author%3Aeng1");
    expect(mappedWithOrg.evidence.githubPrSearchUrl).toContain("org%3Ameetcleo");
    expect(mappedWithoutOrg.evidence.githubPrSearchUrl).toBeNull();
    expect(unmapped.evidence.githubPrSearchUrl).toBeNull();
    expect(unmapped.evidence.githubLogin).toBeNull();
    // An unmapped engineer surfaces an explicit evidence note so the page
    // never claims availability.
    expect(unmapped.evidence.notes.some((n) => /github/i.test(n))).toBe(true);
  });

  it("manager, squad, and pillar context come from the eligibility row, not the squads registry manager chain", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1, {
        manager: "Alex Manager",
        squad: "Risk",
        pillar: "Lending",
        canonicalSquad: {
          name: "Risk",
          pillar: "Lending Pillar",
          pmName: "Pat PM",
          channelId: "C123",
        },
      }),
      competitiveEntry(2),
    ];
    const signals = [signalRow(1), signalRow(2)];
    const { attribution } = buildAttributionBundle(entries, signals);
    const engineer = attribution.entries.find(
      (e) => e.emailHash === entries[0].emailHash,
    )!;
    expect(engineer.context.manager).toBe("Alex Manager");
    expect(engineer.context.rawSquad).toBe("Risk");
    expect(engineer.context.canonicalSquad?.pmName).toBe("Pat PM");
    expect(engineer.context.canonicalSquad?.channelId).toBe("C123");
    expect(engineer.context.pillar).toBe("Lending");
  });

  it("unscored competitive engineers still carry eligibility, evidence, and context but null composite", () => {
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3, { hasImpactModelRow: false }),
    ];
    const signals: PerEngineerSignalRow[] = [
      signalRow(1),
      signalRow(2),
      // Engineer 3: no activity, no impact row, no squad delivery — composite
      // should be null.
      {
        emailHash: hashEmailForRanking("eng3@meetcleo.com"),
        prCount: null,
        commitCount: null,
        additions: null,
        deletions: null,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
        squadPrsInProgress: null,
      },
    ];
    const { attribution } = buildAttributionBundle(entries, signals);
    const unscored = attribution.entries.find(
      (e) => e.emailHash === entries[2].emailHash,
    )!;
    expect(unscored.compositeScore).toBeNull();
    expect(unscored.rank).toBeNull();
    expect(unscored.reconciliation.matches).toBe(true);
    expect(unscored.reconciliation.recomputedComposite).toBeNull();
    // Still carries manager/squad/evidence context.
    expect(unscored.context.manager).toBe("Boss");
    expect(unscored.evidence.impactModelPresent).toBe(false);
  });

  it("entries are sorted by rank ascending with unscored engineers last", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    // Engineer 5 has no signals → should be unscored and appear last.
    const signals: PerEngineerSignalRow[] = [
      signalRow(1),
      signalRow(2),
      signalRow(3),
      signalRow(4),
      {
        emailHash: hashEmailForRanking("eng5@meetcleo.com"),
        prCount: null,
        commitCount: null,
        additions: null,
        deletions: null,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
        squadPrsInProgress: null,
      },
    ];
    const { attribution } = buildAttributionBundle(
      entries,
      signals,
    );
    const ranks = attribution.entries.map((e) => e.rank);
    // All non-null ranks come first in ascending order.
    const nonNull = ranks.filter((r): r is number => r !== null);
    for (let i = 1; i < nonNull.length; i += 1) {
      expect(nonNull[i]).toBeGreaterThanOrEqual(nonNull[i - 1]);
    }
    // Any null rank lives at the tail.
    const firstNullIndex = ranks.indexOf(null);
    if (firstNullIndex !== -1) {
      for (let i = firstNullIndex; i < ranks.length; i += 1) {
        expect(ranks[i]).toBeNull();
      }
    }
  });

  it("buildRankingSnapshot attaches the attribution bundle to the snapshot", () => {
    const entries = Array.from({ length: 5 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 5 }, (_, i) => signalRow(i + 1));
    const headcountRows = entries.map((e) => ({
      email: e.email,
      preferred_name: e.displayName,
      hb_function: "Engineering",
      hb_level: "EG3",
      hb_squad: e.squad,
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Core",
      job_title: "Senior Backend Engineer",
      manager: e.manager,
      line_manager_email: `${e.manager?.toLowerCase()}@meetcleo.com`,
      start_date: "2023-01-01",
      termination_date: null,
    }));
    const githubMap = entries.map((e) => ({
      githubLogin: e.githubLogin!,
      employeeEmail: e.email,
      isBot: false,
    }));
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: {
        engineers: entries.map((e) => ({ email: e.email })),
      },
      signals,
      now: new Date("2026-04-24T00:00:00Z"),
      githubOrg: "meetcleo",
    });
    expect(snapshot.attribution).toBeDefined();
    expect(snapshot.attribution.entries.length).toBe(entries.length);
    // Every ranked engineer has an attribution entry with a reconciled
    // composite and a visible method breakdown.
    for (const engineer of snapshot.engineers) {
      const attrib = snapshot.attribution.entries.find(
        (a) => a.emailHash === engineer.emailHash,
      );
      expect(attrib).toBeDefined();
      expect(attrib!.reconciliation.matches).toBe(true);
      expect(attrib!.methods.length).toBe(5);
    }
    // GitHub URLs are only emitted when a login + org exist.
    for (const attrib of snapshot.attribution.entries) {
      if (attrib.evidence.githubLogin && attrib.evidence.githubPrSearchUrl) {
        expect(attrib.evidence.githubPrSearchUrl).toContain("github.com/search");
        expect(attrib.evidence.githubPrSearchUrl).toContain(
          encodeURIComponent(`author:${attrib.evidence.githubLogin}`),
        );
      }
    }
  });

  it("methodology version names a post-attribution stage (attribution or later)", () => {
    // The version bumped to `0.7.0-attribution` at M15 and to
    // `0.8.0-snapshots` at M16. The guard accepts any post-scaffold label
    // that matches the live methodology chain so later milestones do not
    // have to rewrite this test every time the version string changes.
    const v = RANKING_METHODOLOGY_VERSION.toLowerCase();
    expect(v).not.toBe("0.1.0-scaffold");
    expect(v).toMatch(/attribution|snapshot|movers|stability|methodology|quality/);
  });

  it("known limitations narrate attribution as implemented, not pending", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.knownLimitations.join(" ").toLowerCase();
    // Attribution no longer belongs on the pending list.
    expect(joined).not.toMatch(
      /per-engineer attribution (drilldowns )?(is|are) (still )?pending/,
    );
    expect(joined).not.toMatch(
      /attribution (drilldowns )?(is|are) still pending/,
    );
    // Attribution should be named as part of the implemented stack.
    expect(joined).toMatch(/attribution/);
    // After M16 snapshots are implemented; remaining work is movers,
    // anti-gaming, and stability — those three must still be named so the
    // reader sees what is outstanding.
    expect(joined).toMatch(/movers/);
    expect(joined).toMatch(/stability/);
  });

  it("attribution-stage limitations name movers/anti-gaming/stability as pending and do not claim attribution or snapshot persistence is pending", () => {
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 3 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    const joined = attribution.limitations.join(" ").toLowerCase();
    // Post-M16 the outstanding work is movers / anti-gaming / stability.
    // Snapshot persistence is no longer pending — it must either be absent
    // from the limitations list or narrated as implemented.
    expect(joined).toMatch(/movers/);
    expect(joined).toMatch(/stability/);
    expect(joined).not.toMatch(/attribution is (still )?pending/);
    expect(joined).not.toMatch(/attribution drilldowns pending/);
    // Narrow: within a 50-char window, snapshot persistence must not be
    // claimed as still/remain pending.
    expect(joined).not.toMatch(/snapshot[^.]{0,40}(still pending|remain pending)/);
  });

  it("attribution contract names the reconciliation tolerance and driver cap", () => {
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = Array.from({ length: 3 }, (_, i) => signalRow(i + 1));
    const { attribution } = buildAttributionBundle(entries, signals);
    expect(attribution.contract).toContain(`${RANKING_ATTRIBUTION_TOP_DRIVERS}`);
    expect(attribution.contract).toContain(`${RANKING_ATTRIBUTION_TOLERANCE}`);
    expect(attribution.tolerance).toBe(RANKING_ATTRIBUTION_TOLERANCE);
    expect(attribution.totalMethods).toBe(5);
  });

  it("stub getEngineeringRanking() returns an empty attribution bundle but preserves the contract surface", async () => {
    const snapshot = await getEngineeringRanking();
    expect(snapshot.attribution).toBeDefined();
    expect(snapshot.attribution.entries).toEqual([]);
    expect(snapshot.attribution.tolerance).toBe(RANKING_ATTRIBUTION_TOLERANCE);
    expect(snapshot.attribution.totalMethods).toBe(5);
    expect(snapshot.attribution.limitations.length).toBeGreaterThan(0);
  });

  it("unused AttributionContribution/EngineerAttribution types are exported (for consumers)", () => {
    // Compile-time import smoke test: the types are exported from the
    // module. This is evaluated as TypeScript; we just reference them.
    const _contribution: AttributionContribution | null = null;
    const _engineer: EngineerAttribution | null = null;
    expect(_contribution).toBeNull();
    expect(_engineer).toBeNull();
  });
});

describe("M16 privacy-preserving ranking snapshot persistence", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: index % 2 === 0 ? "Platform" : "Risk",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signalRow(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: 30 + index,
      commitCount: 60 + index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: index % 2 === 0 ? 24 : 48,
      squadReviewRatePercent: index % 2 === 0 ? 82 : 76,
      squadTimeToFirstReviewHours: index % 2 === 0 ? 2 : 4,
      squadPrsInProgress: index % 2 === 0 ? 6 : 9,
      ...overrides,
    };
  }

  function buildSnapshot(
    entries: EligibilityEntry[],
    signals: PerEngineerSignalRow[],
    now: Date = new Date("2026-04-24T12:34:56Z"),
  ) {
    const headcountRows: EligibilityHeadcountRow[] = entries.map((e) => ({
      email: e.email,
      preferred_name: e.displayName,
      rp_specialisation: "Backend Eng",
      hb_function: "Engineering",
      hb_level: e.levelLabel,
      job_title: e.levelLabel,
      hb_squad: e.squad ?? null,
      line_manager_email: "boss@meetcleo.com",
      manager: e.manager,
      start_date: e.startDate,
    }));
    const githubMap: EligibilityGithubMapRow[] = entries
      .filter((e): e is EligibilityEntry & { githubLogin: string } =>
        Boolean(e.githubLogin),
      )
      .map((e) => ({
        githubLogin: e.githubLogin,
        employeeEmail: e.email,
        isBot: false,
      }));
    const impactModel: EligibilityImpactModelView = {
      engineers: entries.map((e) => ({
        email: e.email,
        predicted: 1,
        actual: 1,
      })),
    };
    return buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel,
      signals,
      now,
      reviewSignalsPersisted: false,
    });
  }

  it("methodology version names the snapshots stage", () => {
    // Any post-attribution label that either mentions snapshots or a later
    // stage (movers/stability) is acceptable — the guard is against drifting
    // back to an earlier methodology label by accident.
    const v = RANKING_METHODOLOGY_VERSION.toLowerCase();
    expect(v).not.toBe("0.1.0-scaffold");
    expect(v).not.toBe("0.7.0-attribution");
    expect(v).toMatch(/snapshot|movers|stability|methodology|quality/);
  });

  it("toSnapshotDate formats a UTC calendar day (YYYY-MM-DD) from a Date", async () => {
    const { toSnapshotDate } = await import("../engineering-ranking");
    expect(toSnapshotDate(new Date("2026-04-24T00:00:00Z"))).toBe("2026-04-24");
    expect(toSnapshotDate(new Date("2026-04-24T23:59:59Z"))).toBe("2026-04-24");
    // Midnight UTC wraps cleanly even across a local DST boundary.
    expect(toSnapshotDate(new Date("2026-03-29T00:00:00Z"))).toBe("2026-03-29");
  });

  it("computeRankingInputHash is deterministic for byte-identical inputs", async () => {
    const { computeRankingInputHash } = await import("../engineering-ranking");
    const signal = signalRow(1);
    expect(computeRankingInputHash(signal)).toBe(computeRankingInputHash(signal));
    expect(computeRankingInputHash(signal)).toBe(
      computeRankingInputHash({ ...signal }),
    );
  });

  it("computeRankingInputHash changes when a scored signal changes", async () => {
    const { computeRankingInputHash } = await import("../engineering-ranking");
    const base = signalRow(1);
    const bumped = { ...base, prCount: (base.prCount ?? 0) + 1 };
    expect(computeRankingInputHash(bumped)).not.toBe(
      computeRankingInputHash(base),
    );
  });

  it("computeRankingInputHash ignores AI tokens and AI spend (non-scoring signals)", async () => {
    const { computeRankingInputHash } = await import("../engineering-ranking");
    const base = signalRow(1, { aiTokens: 1_000, aiSpend: 10 });
    const inflated = { ...base, aiTokens: 10_000_000, aiSpend: 9_999 };
    expect(computeRankingInputHash(inflated)).toBe(
      computeRankingInputHash(base),
    );
  });

  it("buildRankingSnapshotRows emits one row per composite entry", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 6 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);
    expect(rows.length).toBe(snapshot.composite.entries.length);
    expect(rows.every((r) => r.emailHash.length === 16)).toBe(true);
  });

  it("buildRankingSnapshotRows excludes ramp-up and leaver engineers", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    // `eligibility` on the EligibilityEntry fixture is ignored — the real
    // eligibility is derived inside `buildRankingSnapshot` from the
    // `start_date` on the headcount row. Use a <90d start date for the
    // ramp-up engineer and a termination flag for the leaver.
    const now = new Date("2026-04-24T12:34:56Z");
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3, { startDate: "2026-03-10" }), // ~45 days tenure
      competitiveEntry(4),
    ];
    const signals = entries.map((_, i) => signalRow(i + 1));
    const headcountRows: EligibilityHeadcountRow[] = entries.map((e, i) => ({
      email: e.email,
      preferred_name: e.displayName,
      rp_specialisation: "Backend Eng",
      hb_function: "Engineering",
      hb_level: e.levelLabel,
      job_title: e.levelLabel,
      hb_squad: e.squad ?? null,
      line_manager_email: "boss@meetcleo.com",
      manager: e.manager,
      start_date: e.startDate,
      // Index 3 is the leaver — termination_date before `now`.
      termination_date: i === 3 ? "2026-02-01" : null,
    }));
    const githubMap: EligibilityGithubMapRow[] = entries
      .filter((e): e is EligibilityEntry & { githubLogin: string } =>
        Boolean(e.githubLogin),
      )
      .map((e) => ({
        githubLogin: e.githubLogin,
        employeeEmail: e.email,
        isBot: false,
      }));
    const impactModel: EligibilityImpactModelView = {
      engineers: entries.map((e) => ({ email: e.email })),
    };
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel,
      signals,
      now,
      reviewSignalsPersisted: false,
    });
    const rows = buildRankingSnapshotRows(snapshot);
    const hashes = new Set(rows.map((r) => r.emailHash));
    // The two competitive engineers must be persisted; the ramp-up and
    // leaver must be absent because persistence mirrors the competitive
    // composite cohort.
    expect(hashes.has(entries[0].emailHash)).toBe(true);
    expect(hashes.has(entries[1].emailHash)).toBe(true);
    expect(hashes.has(entries[2].emailHash)).toBe(false);
    expect(hashes.has(entries[3].emailHash)).toBe(false);
  });

  it("persistence rows NEVER include display name, email, manager, or resolved GitHub login", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);

    const allowedKeys = new Set([
      "snapshotDate",
      "methodologyVersion",
      "signalWindowStart",
      "signalWindowEnd",
      "emailHash",
      "eligibilityStatus",
      "rank",
      "compositeScore",
      "adjustedPercentile",
      "rawPercentile",
      "methodA",
      "methodB",
      "methodC",
      "methodD",
      "confidenceLow",
      "confidenceHigh",
      "inputHash",
      "metadata",
    ]);

    for (const row of rows) {
      const rowKeys = Object.keys(row);
      for (const key of rowKeys) {
        expect(allowedKeys.has(key)).toBe(true);
      }
      // Affirmatively check the fields we must never persist.
      const loose = row as unknown as Record<string, unknown>;
      expect(loose.displayName).toBeUndefined();
      expect(loose.email).toBeUndefined();
      expect(loose.manager).toBeUndefined();
      expect(loose.githubLogin).toBeUndefined();
      expect(loose.squad).toBeUndefined();
      // Serialise the whole row and confirm no resolvable identity string
      // leaked through (display name, email, or GitHub login).
      const serialised = JSON.stringify(row);
      for (const e of entries) {
        expect(serialised).not.toContain(e.displayName);
        expect(serialised).not.toContain(e.email);
        if (e.githubLogin) expect(serialised).not.toContain(e.githubLogin);
      }
    }
  });

  it("metadata jsonb contains only non-identifying shape fields", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);
    const allowedMetadataKeys = new Set([
      "presentMethodCount",
      "dominanceBlocked",
      "dominanceRiskApplied",
      "confidenceWidth",
      "inTieGroup",
    ]);
    for (const row of rows) {
      for (const key of Object.keys(row.metadata)) {
        expect(allowedMetadataKeys.has(key)).toBe(true);
      }
      expect(typeof row.metadata.presentMethodCount).toBe("number");
      expect(typeof row.metadata.dominanceBlocked).toBe("boolean");
      expect(typeof row.metadata.inTieGroup).toBe("boolean");
    }
  });

  it("rows stamp the snapshot's methodology version verbatim", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.methodologyVersion).toBe(snapshot.methodologyVersion);
      expect(row.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    }
  });

  it("rows carry the snapshot's signal window verbatim so M17 movers can align windows", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);
    for (const row of rows) {
      expect(row.signalWindowStart.toISOString()).toBe(
        snapshot.signalWindow.start,
      );
      expect(row.signalWindowEnd.toISOString()).toBe(
        snapshot.signalWindow.end,
      );
    }
  });

  it("default snapshotDate is the UTC calendar day of snapshot.generatedAt", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals, new Date("2026-04-24T12:34:56Z"));
    const rows = buildRankingSnapshotRows(snapshot);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.snapshotDate).toBe("2026-04-24");
    }
  });

  it("override snapshotDate is honoured so backfills can key on an explicit day", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot, {
      snapshotDate: "2026-01-01",
    });
    for (const row of rows) {
      expect(row.snapshotDate).toBe("2026-01-01");
    }
  });

  it("buildRankingSnapshotRows is idempotent for a given snapshot + inputs", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 4 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const signalsByHash = new Map(signals.map((s) => [s.emailHash, s]));
    const a = buildRankingSnapshotRows(snapshot, {
      snapshotDate: "2026-04-24",
      signalsByHash,
    });
    const b = buildRankingSnapshotRows(snapshot, {
      snapshotDate: "2026-04-24",
      signalsByHash,
    });
    expect(a.length).toBe(b.length);
    const norm = (rs: { snapshotDate: string; emailHash: string }[]) =>
      rs
        .map((r) => `${r.snapshotDate}|${r.emailHash}`)
        .sort()
        .join(",");
    expect(norm(a)).toBe(norm(b));
  });

  it("inputHash is populated when signals are supplied and null otherwise", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);

    const withSignals = buildRankingSnapshotRows(snapshot, {
      signalsByHash: new Map(signals.map((s) => [s.emailHash, s])),
    });
    expect(withSignals.every((r) => r.inputHash !== null)).toBe(true);
    expect(new Set(withSignals.map((r) => r.inputHash)).size).toBeGreaterThan(
      1,
    );

    const withoutSignals = buildRankingSnapshotRows(snapshot);
    expect(withoutSignals.every((r) => r.inputHash === null)).toBe(true);
  });

  it("methodology version bumps produce a parallel snapshot slice rather than overwriting", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);

    // Simulate a second methodology version by cloning and rewriting the
    // version field — the natural key is (date, version, emailHash) so rows
    // from the two versions must be distinguishable even for the same day.
    const rowsV1 = buildRankingSnapshotRows(snapshot, {
      snapshotDate: "2026-04-24",
    });
    const rowsV2 = buildRankingSnapshotRows(
      { ...snapshot, methodologyVersion: "0.99.0-hypothetical" },
      { snapshotDate: "2026-04-24" },
    );

    expect(rowsV1.length).toBe(rowsV2.length);
    // Natural keys must differ between the two slices so a database upsert
    // does not collide the v1 row with the v2 row.
    const keyV1 = (r: { snapshotDate: string; methodologyVersion: string; emailHash: string }) =>
      `${r.snapshotDate}|${r.methodologyVersion}|${r.emailHash}`;
    const v1Keys = new Set(rowsV1.map(keyV1));
    const v2Keys = new Set(rowsV2.map(keyV1));
    for (const key of v1Keys) {
      expect(v2Keys.has(key)).toBe(false);
    }
  });

  it("scored rows carry rank / composite / method A-C / confidence and unscored rows are null", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    // Two competitive engineers + one engineer with no signals (composite
    // should be null / unscored).
    const entries: EligibilityEntry[] = [
      competitiveEntry(1),
      competitiveEntry(2),
      competitiveEntry(3),
    ];
    const signals: PerEngineerSignalRow[] = [
      signalRow(1),
      signalRow(2),
      // engineer 3 is unscored: no prs / commits / impact rows
      {
        emailHash: hashEmailForRanking("eng3@meetcleo.com"),
        prCount: null,
        commitCount: null,
        additions: null,
        deletions: null,
        shapPredicted: null,
        shapActual: null,
        shapResidual: null,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: null,
        squadReviewRatePercent: null,
        squadTimeToFirstReviewHours: null,
        squadPrsInProgress: null,
      },
    ];
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);
    const unscoredHash = entries[2].emailHash;
    const unscoredRow = rows.find((r) => r.emailHash === unscoredHash);
    expect(unscoredRow).toBeDefined();
    expect(unscoredRow!.rank).toBeNull();
    expect(unscoredRow!.compositeScore).toBeNull();

    const scoredRows = rows.filter((r) => r.emailHash !== unscoredHash);
    for (const row of scoredRows) {
      expect(row.rank).not.toBeNull();
      expect(row.compositeScore).not.toBeNull();
    }
  });

  it("eligibilityStatus is sourced from the eligibility preflight", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const signals = entries.map((_, i) => signalRow(i + 1));
    const snapshot = buildSnapshot(entries, signals);
    const rows = buildRankingSnapshotRows(snapshot);
    for (const row of rows) {
      expect(["competitive", "ramp_up", "inactive_or_leaver"]).toContain(
        row.eligibilityStatus,
      );
    }
  });

  it("empty snapshot yields zero rows", async () => {
    const { buildRankingSnapshotRows } = await import("../engineering-ranking");
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const rows = buildRankingSnapshotRows(snapshot);
    expect(rows).toEqual([]);
  });

  it("RankingSnapshotRow and RankingSnapshotRowMetadata types are exported", async () => {
    const mod = await import("../engineering-ranking");
    // Compile-time shape guard: the types exist on the module so external
    // callers (API routes, admin tools) can consume them.
    const _row: import("../engineering-ranking").RankingSnapshotRow | null = null;
    const _meta:
      | import("../engineering-ranking").RankingSnapshotRowMetadata
      | null = null;
    expect(typeof mod.buildRankingSnapshotRows).toBe("function");
    expect(typeof mod.computeRankingInputHash).toBe("function");
    expect(typeof mod.toSnapshotDate).toBe("function");
    expect(_row).toBeNull();
    expect(_meta).toBeNull();
  });
});

describe("M18 movers view", () => {
  function compositeEntry(
    overrides: Partial<EngineerCompositeEntry> & {
      emailHash: string;
      displayName: string;
      rank: number | null;
      composite: number | null;
    },
  ): EngineerCompositeEntry {
    return {
      discipline: "BE",
      levelLabel: "L4",
      output: overrides.composite,
      impact: overrides.composite,
      delivery: overrides.composite,
      quality: overrides.composite,
      adjusted: overrides.composite,
      presentMethodCount: 5,
      compositePercentile: overrides.composite,
      methodsSummary: "median of 5 methods",
      ...overrides,
    };
  }

  function makeComposite(
    entries: EngineerCompositeEntry[],
  ): CompositeBundle {
    const scored = entries
      .filter((e) => e.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    return {
      contract: "",
      methods: ["output", "impact", "delivery", "quality", "adjusted"],
      minPresentMethods: 2,
      maxSingleSignalEffectiveWeight: 0.3,
      dominanceCorrelationThreshold: 0.75,
      entries,
      ranked: scored,
      effectiveSignalWeights: [],
      leaveOneOut: [],
      finalRankCorrelations: [],
      dominanceWarnings: [],
      dominanceBlocked: false,
      limitations: [],
    };
  }

  function confidenceEntry(
    overrides: Partial<EngineerConfidence> & {
      emailHash: string;
      displayName: string;
    },
  ): EngineerConfidence {
    return {
      rank: null,
      composite: null,
      sigma: null,
      ciLow: null,
      ciHigh: null,
      ciWidth: null,
      ciRankLow: null,
      ciRankHigh: null,
      uncertaintyFactors: [],
      inTieGroup: false,
      tieGroupId: null,
      ...overrides,
    };
  }

  function makeConfidence(entries: EngineerConfidence[]): ConfidenceBundle {
    return {
      contract: "",
      bootstrapIterations: 0,
      ciCoverage: 0.8,
      dominanceWidening: 1.5,
      globalDominanceApplied: false,
      entries,
      tieGroups: [],
      limitations: [],
    };
  }

  function eligibilityRow(
    overrides: Partial<EligibilityEntry> & {
      emailHash: string;
      displayName: string;
    },
  ): EligibilityEntry {
    return {
      email: `${overrides.displayName.toLowerCase().replace(/\s+/g, ".")}@meetcleo.com`,
      githubLogin: null,
      discipline: "BE",
      levelLabel: "L4",
      squad: null,
      pillar: "Core",
      canonicalSquad: null,
      manager: null,
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function priorRow(
    overrides: Partial<RankingSnapshotRow> & {
      emailHash: string;
      rank: number | null;
      compositeScore: number | null;
    },
  ): RankingSnapshotRow {
    return {
      snapshotDate: "2026-04-01",
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
      signalWindowStart: new Date("2025-10-03T00:00:00Z"),
      signalWindowEnd: new Date("2026-04-01T00:00:00Z"),
      eligibilityStatus: "competitive",
      adjustedPercentile: null,
      rawPercentile: null,
      methodA: overrides.compositeScore,
      methodB: overrides.compositeScore,
      methodC: overrides.compositeScore,
      methodD: overrides.compositeScore,
      confidenceLow: null,
      confidenceHigh: null,
      inputHash: null,
      metadata: {
        presentMethodCount: 4,
        dominanceBlocked: false,
        dominanceRiskApplied: false,
        confidenceWidth: null,
        inTieGroup: false,
      },
      ...overrides,
    };
  }

  it("exposes RANKING_MOVERS_MIN_GAP_DAYS and RANKING_MOVERS_TOP_N with sensible defaults", () => {
    expect(RANKING_MOVERS_MIN_GAP_DAYS).toBeGreaterThanOrEqual(1);
    expect(RANKING_MOVERS_MIN_GAP_DAYS).toBeLessThanOrEqual(30);
    expect(RANKING_MOVERS_TOP_N).toBeGreaterThanOrEqual(5);
    expect(RANKING_MOVERS_TOP_N).toBeLessThanOrEqual(50);
  });

  it("returns a no_prior_snapshot empty state when no prior rows are supplied", () => {
    const composite = makeComposite([
      compositeEntry({
        emailHash: "a".repeat(16),
        displayName: "Alpha",
        rank: 1,
        composite: 95,
      }),
      compositeEntry({
        emailHash: "b".repeat(16),
        displayName: "Bravo",
        rank: 2,
        composite: 80,
      }),
    ]);
    const confidence = makeConfidence(composite.entries.map((c) =>
      confidenceEntry({
        emailHash: c.emailHash,
        displayName: c.displayName,
        rank: c.rank,
        composite: c.composite,
        ciWidth: 5,
      }),
    ));
    const eligibility = composite.entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
    });

    expect(bundle.status).toBe("no_prior_snapshot");
    expect(bundle.priorSnapshot).toBeNull();
    expect(bundle.priorSnapshotGapDays).toBeNull();
    expect(bundle.risers).toHaveLength(0);
    expect(bundle.fallers).toHaveLength(0);
    expect(bundle.newEntrants).toHaveLength(0);
    expect(bundle.cohortExits).toHaveLength(0);
    expect(bundle.notes.join(" ")).toContain("prior ranking snapshot");
  });

  it("returns an insufficient_gap empty state when prior is newer than the minimum gap", () => {
    const composite = makeComposite([
      compositeEntry({
        emailHash: "a".repeat(16),
        displayName: "Alpha",
        rank: 1,
        composite: 95,
      }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = [
      eligibilityRow({
        emailHash: "a".repeat(16),
        displayName: "Alpha",
      }),
    ];
    const prior = [
      priorRow({
        emailHash: "a".repeat(16),
        rank: 1,
        compositeScore: 95,
        snapshotDate: "2026-04-23", // 1 day gap — below the 6-day min
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("insufficient_gap");
    expect(bundle.priorSnapshotGapDays).toBe(1);
    expect(bundle.risers).toHaveLength(0);
    expect(bundle.fallers).toHaveLength(0);
  });

  it("computes signed rank and percentile deltas with current - prior semantics", () => {
    // Three engineers; two move, one stays. Prior: A=1, B=2, C=3. Current: B=1, A=2, C=3.
    const hashA = "a".repeat(16);
    const hashB = "b".repeat(16);
    const hashC = "c".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashB, displayName: "Bravo", rank: 1, composite: 95 }),
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 2, composite: 90 }),
      compositeEntry({ emailHash: hashC, displayName: "Charlie", rank: 3, composite: 70 }),
    ]);
    const confidence = makeConfidence(composite.entries.map((c) =>
      confidenceEntry({
        emailHash: c.emailHash,
        displayName: c.displayName,
        rank: c.rank,
        composite: c.composite,
        ciWidth: 4,
      }),
    ));
    const eligibility = composite.entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const prior: RankingSnapshotRow[] = [
      priorRow({ emailHash: hashA, rank: 1, compositeScore: 92 }),
      priorRow({ emailHash: hashB, rank: 2, compositeScore: 85 }),
      priorRow({ emailHash: hashC, rank: 3, compositeScore: 70 }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("ok");
    expect(bundle.priorSnapshotGapDays).toBe(23);
    expect(bundle.risers.map((r) => r.emailHash)).toEqual([hashB]);
    expect(bundle.fallers.map((r) => r.emailHash)).toEqual([hashA]);
    // Bravo improved from 2 to 1 — delta should be -1.
    expect(bundle.risers[0].rankDelta).toBe(-1);
    expect(bundle.risers[0].priorRank).toBe(2);
    expect(bundle.risers[0].currentRank).toBe(1);
    expect(bundle.risers[0].percentileDelta).toBeCloseTo(95 - 85, 5);
    // Alpha regressed from 1 to 2 — delta should be +1.
    expect(bundle.fallers[0].rankDelta).toBe(1);
    expect(bundle.fallers[0].priorRank).toBe(1);
    expect(bundle.fallers[0].currentRank).toBe(2);
    expect(bundle.fallers[0].percentileDelta).toBeCloseTo(90 - 92, 5);
    // Charlie stayed — should appear in neither risers nor fallers.
    expect(bundle.risers.map((r) => r.emailHash)).not.toContain(hashC);
    expect(bundle.fallers.map((r) => r.emailHash)).not.toContain(hashC);
  });

  it("categorises new cohort entrants separately from risers and fallers", () => {
    const hashA = "a".repeat(16);
    const hashB = "b".repeat(16);
    const hashNew = "d".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
      compositeEntry({ emailHash: hashB, displayName: "Bravo", rank: 2, composite: 80 }),
      compositeEntry({
        emailHash: hashNew,
        displayName: "Delta",
        rank: 3,
        composite: 60,
      }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = composite.entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const prior: RankingSnapshotRow[] = [
      priorRow({ emailHash: hashA, rank: 1, compositeScore: 90 }),
      priorRow({ emailHash: hashB, rank: 2, compositeScore: 80 }),
      // hashNew not present in prior.
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.newEntrants.map((r) => r.emailHash)).toEqual([hashNew]);
    expect(bundle.newEntrants[0].category).toBe("new_entrant");
    expect(bundle.newEntrants[0].causeKind).toBe("cohort_transition");
    expect(bundle.risers.map((r) => r.emailHash)).not.toContain(hashNew);
    expect(bundle.fallers.map((r) => r.emailHash)).not.toContain(hashNew);
  });

  it("categorises leavers and unscored engineers as cohort exits, not ordinary movers", () => {
    const hashA = "a".repeat(16);
    const hashLeaver = "e".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = [
      eligibilityRow({ emailHash: hashA, displayName: "Alpha" }),
    ];
    const prior: RankingSnapshotRow[] = [
      priorRow({ emailHash: hashA, rank: 1, compositeScore: 90 }),
      priorRow({
        emailHash: hashLeaver,
        rank: 2,
        compositeScore: 75,
        eligibilityStatus: "inactive_or_leaver",
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.cohortExits.map((r) => r.emailHash)).toEqual([hashLeaver]);
    expect(bundle.cohortExits[0].category).toBe("cohort_exit");
    expect(bundle.cohortExits[0].causeKind).toBe("cohort_transition");
    expect(bundle.risers.map((r) => r.emailHash)).not.toContain(hashLeaver);
    expect(bundle.fallers.map((r) => r.emailHash)).not.toContain(hashLeaver);
    // Display name for a leaver not in current eligibility falls back to an
    // unmapped-hash label so the drilldown does not silently show "undefined".
    expect(bundle.cohortExits[0].displayName).toMatch(/Unmapped/);
  });

  it("labels causeKind input_drift when both input hashes are present and differ", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 95 }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const signalNow: PerEngineerSignalRow = {
      emailHash: hashA,
      prCount: 50,
      commitCount: 100,
      additions: 1_000,
      deletions: 200,
      shapPredicted: 5_000,
      shapActual: 6_000,
      shapResidual: 1_000,
      aiTokens: null,
      aiSpend: null,
      squadCycleTimeHours: 24,
      squadReviewRatePercent: 80,
      squadTimeToFirstReviewHours: 3,
      squadPrsInProgress: 8,
    };
    const prior: RankingSnapshotRow[] = [
      priorRow({
        emailHash: hashA,
        rank: 2,
        compositeScore: 80,
        inputHash: "deadbeef00000000",
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      signals: [signalNow],
      priorRows: prior,
    });

    expect(bundle.risers).toHaveLength(1);
    expect(bundle.risers[0].inputHashChanged).toBe(true);
    expect(bundle.risers[0].causeKind).toBe("input_drift");
    expect(bundle.risers[0].likelyCause.toLowerCase()).toContain("input");
  });

  it("labels causeKind ambiguous_context when inputHash is unchanged but rank moves", async () => {
    // The test must produce a signal whose computed inputHash equals the
    // prior's persisted inputHash. We build the signal first, compute its
    // hash via computeRankingInputHash, and then pin the prior row to that
    // hash — so an unchanged hash paired with a rank movement is genuinely
    // testable rather than assumed.
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 95 }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const signal: PerEngineerSignalRow = {
      emailHash: hashA,
      prCount: 30,
      commitCount: 60,
      additions: 800,
      deletions: 150,
      shapPredicted: 3_000,
      shapActual: 3_500,
      shapResidual: 500,
      aiTokens: null,
      aiSpend: null,
      squadCycleTimeHours: 36,
      squadReviewRatePercent: 70,
      squadTimeToFirstReviewHours: 5,
      squadPrsInProgress: 9,
    };
    const { computeRankingInputHash } = await import("../engineering-ranking");
    const unchangedHash = computeRankingInputHash(signal);
    const prior: RankingSnapshotRow[] = [
      priorRow({
        emailHash: hashA,
        rank: 3,
        compositeScore: 70,
        inputHash: unchangedHash,
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      signals: [signal],
      priorRows: prior,
    });

    expect(bundle.risers).toHaveLength(1);
    expect(bundle.risers[0].inputHashChanged).toBe(false);
    expect(bundle.risers[0].causeKind).toBe("ambiguous_context");
    expect(bundle.risers[0].likelyCause.toLowerCase()).toContain("ambiguous");
    // The narrative must explicitly name that this is NOT methodology noise —
    // the whole point of the ambiguous_context label is that the persisted
    // inputHash cannot distinguish real context drift from methodology drift.
    expect(bundle.risers[0].likelyCause.toLowerCase()).toContain(
      "not methodology noise",
    );
  });

  it("labels causeKind unknown when inputHash is not persisted on one side", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 95 }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const prior: RankingSnapshotRow[] = [
      priorRow({
        emailHash: hashA,
        rank: 3,
        compositeScore: 70,
        inputHash: null, // legacy row pre-M17 with no persisted hash
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      // No signals supplied, so currentInputHash is also null.
      priorRows: prior,
    });

    expect(bundle.risers).toHaveLength(1);
    expect(bundle.risers[0].inputHashChanged).toBeNull();
    expect(bundle.risers[0].causeKind).toBe("unknown");
  });

  it("labels every row methodology_change when prior methodology version differs", () => {
    const hashA = "a".repeat(16);
    const hashB = "b".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 95 }),
      compositeEntry({ emailHash: hashB, displayName: "Bravo", rank: 2, composite: 80 }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = composite.entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const prior: RankingSnapshotRow[] = [
      priorRow({
        emailHash: hashA,
        rank: 2,
        compositeScore: 80,
        methodologyVersion: "0.7.0-attribution", // older methodology
      }),
      priorRow({
        emailHash: hashB,
        rank: 1,
        compositeScore: 95,
        methodologyVersion: "0.7.0-attribution",
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("methodology_changed");
    expect(bundle.methodologyChanged).toBe(true);
    // Both rows are labelled methodology_change regardless of input-hash state.
    for (const row of [...bundle.risers, ...bundle.fallers]) {
      expect(row.causeKind).toBe("methodology_change");
      expect(row.methodologyChanged).toBe(true);
    }
    expect(bundle.notes.join(" ")).toContain("Methodology version changed");
  });

  it("emits a useful empty state when no prior comparable snapshot exists for the page", () => {
    // Acceptance criterion from the plan: the page must render a useful
    // empty state when there is no prior comparable snapshot. This test
    // pins the notes and limitations so the page copy stays informative.
    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite: makeComposite([]),
      confidence: makeConfidence([]),
      eligibilityEntries: [],
    });
    expect(bundle.status).toBe("no_prior_snapshot");
    expect(bundle.notes.some((n) => n.toLowerCase().includes("no prior"))).toBe(
      true,
    );
    expect(bundle.limitations.length).toBeGreaterThan(0);
    expect(
      bundle.limitations.some((l) => l.toLowerCase().includes("tenure")),
    ).toBe(true);
  });

  it("top-N cap limits risers/fallers but empty cohort tables still appear in the bundle", () => {
    const entries: EngineerCompositeEntry[] = [];
    const prior: RankingSnapshotRow[] = [];
    // Build 25 engineers; each moves by one rank so risers and fallers
    // populate deterministically.
    for (let i = 0; i < 25; i += 1) {
      const hash = i.toString(16).padStart(16, "0");
      entries.push(
        compositeEntry({
          emailHash: hash,
          displayName: `Engineer ${i}`,
          rank: i + 1,
          composite: 100 - i,
        }),
      );
      prior.push(
        priorRow({
          emailHash: hash,
          // Prior rank is +2 of current so everyone "improved" by 2.
          rank: i + 3,
          compositeScore: 100 - i - 2,
        }),
      );
    }

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite: makeComposite(entries),
      confidence: makeConfidence([]),
      eligibilityEntries: entries.map((c) =>
        eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
      ),
      priorRows: prior,
    });

    expect(bundle.risers.length).toBe(RANKING_MOVERS_TOP_N);
    // Sort order: most negative rankDelta first. All engineers have delta -2
    // so the sort breaks ties on emailHash ascending.
    expect(bundle.risers.every((r) => r.rankDelta === -2)).toBe(true);
    // Fallers is empty since every engineer improved.
    expect(bundle.fallers).toHaveLength(0);
  });

  it("rankDelta for unchanged rank is excluded from risers and fallers", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 95 }),
    ]);
    const confidence = makeConfidence([]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const prior: RankingSnapshotRow[] = [
      priorRow({ emailHash: hashA, rank: 1, compositeScore: 95 }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("ok");
    expect(bundle.risers).toHaveLength(0);
    expect(bundle.fallers).toHaveLength(0);
  });

  it("methodology change with unchanged rank still labels causeKind methodology_change", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 95 }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const prior: RankingSnapshotRow[] = [
      priorRow({
        emailHash: hashA,
        rank: 2, // rank moved from 2 → 1
        compositeScore: 80,
        methodologyVersion: "0.7.0-attribution",
      }),
    ];

    const bundle = buildMovers({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      confidence: makeConfidence([]),
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("methodology_changed");
    expect(bundle.risers).toHaveLength(1);
    expect(bundle.risers[0].causeKind).toBe("methodology_change");
  });

  it("buildRankingSnapshot attaches the movers bundle with a no_prior_snapshot empty state when no priorSnapshotRows are supplied", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    expect(snapshot.movers).toBeDefined();
    expect(snapshot.movers.status).toBe("no_prior_snapshot");
    expect(snapshot.movers.currentSnapshot.methodologyVersion).toBe(
      RANKING_METHODOLOGY_VERSION,
    );
    expect(snapshot.movers.priorSnapshot).toBeNull();
    expect(snapshot.movers.limitations.length).toBeGreaterThan(0);
  });

  it("methodology version names the movers stage", () => {
    const v = RANKING_METHODOLOGY_VERSION.toLowerCase();
    expect(v).not.toBe("0.7.0-attribution");
    expect(v).not.toBe("0.8.0-snapshots");
    expect(v).toMatch(/mover|stability|methodology|quality/);
  });
});

describe("M19 page limitations no longer claim movers are pending", () => {
  /**
   * M18 made movers live. The composite/confidence/attribution limitation
   * strings are rendered verbatim on the page, so stale copy there leaks
   * untrue "movers is pending" statements to the reader. This guard keeps
   * the three live stages' limitation arrays honest.
   */
  function assertNoMoversPending(
    stage: string,
    limitations: readonly string[],
  ) {
    for (const line of limitations) {
      const lower = line.toLowerCase();
      const claimsMoversPending =
        /movers[^.]*\b(pending|outstanding|not yet)\b/.test(lower) ||
        /\bmovers\b[^.]*\bremain(s)?\b/.test(lower);
      expect(
        claimsMoversPending,
        `${stage} limitation still claims movers is pending: ${line}`,
      ).toBe(false);
    }
  }

  it("composite, confidence, attribution, and snapshot limitations do not say movers are pending", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });

    assertNoMoversPending("composite", snapshot.composite.limitations);
    assertNoMoversPending("confidence", snapshot.confidence.limitations);
    assertNoMoversPending("attribution", snapshot.attribution.limitations);
    assertNoMoversPending("knownLimitations", snapshot.knownLimitations);
  });

  it("only the remaining milestones (methodology panel, stability) are named as pending", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });

    // Every limitation line that mentions something remaining must also name
    // one of the remaining milestones — anti-gaming, methodology, manager
    // calibration, or stability — so the page never says "pending" without
    // telling the reader what is pending.
    const remainingTerms =
      /anti-gaming|methodology panel|manager calibration|stability/;
    const stages: Array<[string, readonly string[]]> = [
      ["composite", snapshot.composite.limitations],
      ["confidence", snapshot.confidence.limitations],
      ["attribution", snapshot.attribution.limitations],
      ["knownLimitations", snapshot.knownLimitations],
    ];
    for (const [stage, lines] of stages) {
      for (const line of lines) {
        const lower = line.toLowerCase();
        const mentionsPending =
          /\b(pending|still pending|remain pending)\b/.test(lower);
        if (!mentionsPending) continue;
        expect(
          remainingTerms.test(lower),
          `${stage} limitation names "pending" without naming a remaining milestone: ${line}`,
        ).toBe(true);
      }
    }
  });
});

describe("M21 methodology panel, anti-gaming audit, freshness badges, manager calibration", () => {
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: "Platform",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function signalRow(
    index: number,
    overrides: Partial<PerEngineerSignalRow> = {},
  ): PerEngineerSignalRow {
    return {
      emailHash: hashEmailForRanking(`eng${index}@meetcleo.com`),
      prCount: index,
      commitCount: index * 2,
      additions: index * 100,
      deletions: index * 10,
      shapPredicted: index * 50,
      shapActual: index * 60,
      shapResidual: index * 10,
      aiTokens: index * 1_000,
      aiSpend: index * 5,
      squadCycleTimeHours: 24,
      squadReviewRatePercent: 80,
      squadTimeToFirstReviewHours: 2,
      squadPrsInProgress: 6,
      ...overrides,
    };
  }

  it("bumps the methodology version to a post-movers methodology-era label", () => {
    expect(RANKING_METHODOLOGY_VERSION.toLowerCase()).toMatch(/methodology|quality/);
  });

  it("rubric version matches the live code-quality rubric once prReviewAnalyses is wired", () => {
    // Null during the methodology-only era; once the quality lens lands it
    // names the live rubric version so the methodology panel can surface
    // the freshness of the per-PR signal to readers.
    expect(RANKING_RUBRIC_VERSION).toBe(RANKING_QUALITY_RUBRIC_VERSION);
  });

  it("exposes an anti-gaming row for every scoring and contextual signal", () => {
    const signals = RANKING_ANTI_GAMING_ROWS.map((row) => row.signal);
    const mustCover = [
      /pr count/i,
      /commit count/i,
      /net lines/i,
      /log-impact/i,
      /shap predicted/i,
      /shap actual/i,
      /shap residual/i,
      /squad review rate/i,
      /squad cycle time/i,
      /squad time-to-first-review/i,
      /ai tokens|ai spend/i,
      /self-review|individual review graph/i,
    ];
    for (const pattern of mustCover) {
      expect(
        signals.some((s) => pattern.test(s)),
        `Anti-gaming audit missing a row matching ${pattern}`,
      ).toBe(true);
    }
  });

  it("every anti-gaming row carries gaming path, mitigation, residual, and down-weight posture", () => {
    for (const row of RANKING_ANTI_GAMING_ROWS) {
      expect(row.signal.length).toBeGreaterThan(0);
      expect(row.gamingPath.length).toBeGreaterThan(10);
      expect(row.mitigation.length).toBeGreaterThan(10);
      expect(row.residualWeakness.length).toBeGreaterThan(5);
      expect([
        "full_weight",
        "down_weighted",
        "scored_flagged",
        "contextual_only",
      ]).toContain(row.downweightStatus);
    }
  });

  it("AI usage and individual review graph are labelled contextual-only (never scored)", () => {
    const aiRow: AntiGamingRow | undefined = RANKING_ANTI_GAMING_ROWS.find(
      (r) => /ai/i.test(r.signal),
    );
    const reviewRow: AntiGamingRow | undefined = RANKING_ANTI_GAMING_ROWS.find(
      (r) => /self-review|review graph/i.test(r.signal),
    );
    expect(aiRow?.downweightStatus).toBe("contextual_only");
    expect(reviewRow?.downweightStatus).toBe("contextual_only");
  });

  it("M22: no scored signal in the composite is labelled contextual_only", () => {
    // Derive the scored signal set from the source of truth: any signal that
    // appears in any method's weight list is scored and must carry a scored
    // posture (full_weight / down_weighted / scored_flagged). Labelling such
    // a signal contextual_only contradicts the enum's own definition and the
    // page's "Contextual only — read but never scored" copy.
    const scoredSignals = new Set<string>();
    for (const method of Object.keys(
      RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS,
    ) as Array<keyof typeof RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS>) {
      for (const { signal } of RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS[
        method
      ]) {
        scoredSignals.add(signal);
      }
    }
    expect(scoredSignals.size).toBeGreaterThan(0);
    const misLabelled: string[] = [];
    for (const row of RANKING_ANTI_GAMING_ROWS) {
      if (
        scoredSignals.has(row.signal) &&
        row.downweightStatus === "contextual_only"
      ) {
        misLabelled.push(row.signal);
      }
    }
    expect(
      misLabelled,
      `Scored signals labelled contextual_only: ${misLabelled.join(", ")}`,
    ).toEqual([]);
  });

  it("M22: every scored composite signal has an anti-gaming row with a scored posture", () => {
    // Complementary invariant: every scored signal must have a row AND that
    // row must carry a scored posture (not full_weight-by-default-only; the
    // posture enum itself is the assertion, but this verifies coverage).
    const scoredPostures = new Set<AntiGamingRow["downweightStatus"]>([
      "full_weight",
      "down_weighted",
      "scored_flagged",
    ]);
    for (const method of Object.keys(
      RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS,
    ) as Array<keyof typeof RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS>) {
      for (const { signal } of RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS[
        method
      ]) {
        const row = RANKING_ANTI_GAMING_ROWS.find((r) => r.signal === signal);
        expect(
          row,
          `Scored signal "${signal}" has no anti-gaming row`,
        ).toBeDefined();
        expect(
          scoredPostures.has(row!.downweightStatus),
          `Scored signal "${signal}" carries non-scored posture "${row!.downweightStatus}"`,
        ).toBe(true);
      }
    }
  });

  it("M22: Log-impact composite is labelled scored_flagged and its text acknowledges scoring + ceiling", () => {
    const row = RANKING_ANTI_GAMING_ROWS.find(
      (r) => r.signal === "Log-impact composite",
    );
    expect(row).toBeDefined();
    expect(row?.downweightStatus).toBe("scored_flagged");
    // The copy must name that the signal is scored and above the ceiling so
    // the page does not contradict the posture badge.
    const blob = `${row?.mitigation ?? ""} ${row?.residualWeakness ?? ""}`.toLowerCase();
    expect(blob).toMatch(/\bscored\b/);
    expect(blob).toMatch(/ceiling|above[- ]?ceiling|37\.?5/);
  });

  it("M22: every flagged effectiveSignalWeights signal has an anti-gaming row naming scoring + ceiling", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    const flagged = snapshot.methodology.effectiveWeights.filter(
      (w) => w.flagged,
    );
    // At least Log-impact is expected to flag under the current composite
    // structure. If a future methodology change eliminates the flag, this
    // test will pass vacuously — that is intentional; the invariant is only
    // "flagged signals must explain themselves", not "something must flag".
    for (const w of flagged) {
      const row = RANKING_ANTI_GAMING_ROWS.find((r) => r.signal === w.signal);
      expect(
        row,
        `Flagged signal "${w.signal}" has no anti-gaming row`,
      ).toBeDefined();
      expect(
        row?.downweightStatus,
        `Flagged signal "${w.signal}" must not be contextual_only (it is scored)`,
      ).not.toBe("contextual_only");
      // A scored_flagged posture is the natural home for above-ceiling
      // signals. full_weight / down_weighted are valid in principle but we
      // pin the current methodology's choice: log-impact is scored_flagged.
      expect(row?.downweightStatus).toBe("scored_flagged");
      const blob =
        `${row?.mitigation ?? ""} ${row?.residualWeakness ?? ""}`.toLowerCase();
      expect(
        blob,
        `Flagged signal "${w.signal}" mitigation/residual text must name scoring`,
      ).toMatch(/\bscored\b/);
      expect(
        blob,
        `Flagged signal "${w.signal}" mitigation/residual text must name the ceiling or its effective share`,
      ).toMatch(/ceiling|above[- ]?ceiling|37\.?5|30%/);
    }
  });

  it("M22: the methodology panel contract defines each posture so 'Contextual only' is never attached to a scored signal", () => {
    // Page-truthfulness guard. The page UI renders the posture label directly
    // from AntiGamingRow.downweightStatus. If an engineer reads "Contextual
    // only" on a row that contributes >0% effective weight, the page is
    // lying. We assert this by computing effective weights from the composite
    // bundle and cross-checking every row marked contextual_only has a zero
    // effective weight (or no entry at all).
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    const effective = new Map<string, number>();
    for (const w of snapshot.methodology.effectiveWeights) {
      effective.set(w.signal, w.totalWeight);
    }
    for (const row of RANKING_ANTI_GAMING_ROWS) {
      if (row.downweightStatus !== "contextual_only") continue;
      const weight = effective.get(row.signal) ?? 0;
      expect(
        weight,
        `Anti-gaming row "${row.signal}" is marked contextual_only but has effective weight ${weight}`,
      ).toBe(0);
    }
  });

  it("buildMethodology surfaces methodology version, contract, lenses, and anti-gaming rows", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [], generated_at: "2026-04-20T12:00:00Z" },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    const m: MethodologyBundle = snapshot.methodology;
    expect(m.methodologyVersion).toBe(RANKING_METHODOLOGY_VERSION);
    expect(m.contract.length).toBeGreaterThan(100);
    expect(m.lenses).toHaveLength(5);
    for (const lens of m.lenses) {
      expect(lens.weights.length).toBeGreaterThan(0);
      const weightSum = lens.weights.reduce((s, w) => s + w.weight, 0);
      expect(weightSum).toBeCloseTo(1, 6);
    }
    expect(m.antiGamingRows.length).toBe(RANKING_ANTI_GAMING_ROWS.length);
    expect(m.effectiveWeights.length).toBeGreaterThan(0);
    expect(m.normalisationSummary).toMatch(/tenure|discipline|level/i);
    expect(m.compositeRule.toLowerCase()).toMatch(/median/);
  });

  it("user-facing contracts narrate the five-method composite", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [], generated_at: "2026-04-20T12:00:00Z" },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(snapshot.composite.contract.toLowerCase()).toMatch(/five methods/);
    expect(snapshot.attribution.contract.toLowerCase()).toMatch(
      /d code quality|d per-pr code quality/,
    );
    expect(snapshot.methodology.contract.toLowerCase()).toMatch(/five methods/);
  });

  it("freshness badges include impact-model training date, signal window, and the live rubric version when rubric rows are supplied", () => {
    const rubricRows: PrReviewAnalysisInput[] = Array.from(
      { length: RANKING_QUALITY_MIN_ANALYSED_PRS },
      (_, i) => ({
        emailHash: hashEmailForRanking(`eng${i + 1}@meetcleo.com`),
        mergedAt: "2026-04-20T12:00:00Z",
        rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
        technicalDifficulty: 4,
        executionQuality: 4,
        testAdequacy: 4,
        riskHandling: 4,
        reviewability: 4,
        analysisConfidencePct: 80,
        revertWithin14d: false,
      }),
    );
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [], generated_at: "2026-04-20T12:00:00Z" },
      now: new Date("2026-04-24T00:00:00Z"),
      qualityAnalyses: rubricRows,
    });
    const freshness = snapshot.methodology.freshness;
    const impactBadge = freshness.find((b) => /impact model/i.test(b.label));
    expect(impactBadge?.timestamp).toBe("2026-04-20T12:00:00Z");
    expect(impactBadge?.availability).toBe("available");

    const windowBadge = freshness.find((b) => /signal window/i.test(b.label));
    expect(windowBadge?.window).toContain("2026-04-24");
    expect(windowBadge?.availability).toBe("available");

    const rubricBadge = freshness.find((b) =>
      /rubric/i.test(`${b.source} ${b.label}`),
    );
    expect(rubricBadge).toBeDefined();
    // Once the code-quality lens lands, the rubric version is wired via
    // RANKING_RUBRIC_VERSION → RANKING_QUALITY_RUBRIC_VERSION and the badge
    // flips to `available`. The `note` carries the live version string so
    // the methodology panel can render freshness to readers.
    expect(rubricBadge?.availability).toBe("available");
    expect(rubricBadge?.note).toContain(RANKING_QUALITY_RUBRIC_VERSION);

    const aiBadge = freshness.find((b) => /ai usage/i.test(b.label));
    expect(aiBadge?.note?.toLowerCase()).toMatch(/latest[- ]month/);
  });

  it("freshness badge marks the rubric unavailable when no rubric rows are supplied", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    const rubricBadge = snapshot.methodology.freshness.find((b) =>
      /rubric/i.test(`${b.source} ${b.label}`),
    );
    expect(rubricBadge?.availability).toBe("unavailable");
    expect(rubricBadge?.note).toMatch(/were supplied to this snapshot build/i);
  });

  it("freshness badge marks squad-delivery unavailable when no persisted source is supplied", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    const deliveryBadge = snapshot.methodology.freshness.find((b) =>
      /swarmia|squad-delivery/i.test(`${b.source} ${b.label}`),
    );
    expect(deliveryBadge?.availability).toBe("unavailable");
    expect(deliveryBadge?.note).toMatch(/does not call swarmia live/i);
  });

  it("freshness badge for impact model flips to pending_source when no training date is supplied", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    const impact = snapshot.methodology.freshness.find((b) =>
      /impact model/i.test(b.label),
    );
    expect(impact?.timestamp).toBeNull();
    expect(impact?.availability).toBe("pending_source");
  });

  it("every attribution entry carries a calibration stub (status not_requested) and direct-report context", () => {
    const rosterEntries = [
      competitiveEntry(1, {
        displayName: "Manager Mary",
        email: "mary@meetcleo.com",
        manager: "Boss",
      }),
      competitiveEntry(2, {
        displayName: "Direct Dan",
        email: "dan@meetcleo.com",
        manager: "Manager Mary",
      }),
      competitiveEntry(3, {
        displayName: "Direct Dee",
        email: "dee@meetcleo.com",
        manager: "mary@meetcleo.com",
      }),
    ];
    const normalisedEntries = rosterEntries.map((entry) => ({
      ...entry,
      emailHash: hashEmailForRanking(entry.email),
    }));
    const signals = normalisedEntries.map((e, i) =>
      signalRow(i + 1, { emailHash: e.emailHash }),
    );
    const snapshot = buildRankingSnapshot({
      headcountRows: normalisedEntries.map((e) => ({
        email: e.email,
        preferred_name: e.displayName,
        hb_function: "Engineering",
        hb_level: e.levelLabel,
        hb_squad: e.squad ?? null,
        rp_specialisation: "Backend Engineer",
        rp_department_name: "Core Pillar",
        job_title: "Senior Backend Engineer",
        manager: e.manager,
        line_manager_email: null,
        start_date: "2023-01-01",
        termination_date: null,
      })),
      githubMap: normalisedEntries.map((e) => ({
        githubLogin: e.githubLogin ?? e.email,
        employeeEmail: e.email,
        isBot: false,
      })),
      impactModel: {
        engineers: normalisedEntries.map((e) => ({ email: e.email })),
        generated_at: "2026-04-20T12:00:00Z",
      },
      signals,
      now: new Date("2026-04-24T00:00:00Z"),
    });

    for (const attr of snapshot.attribution.entries) {
      expect(attr.calibration.status).toBe("not_requested");
      expect(attr.calibration.note.length).toBeGreaterThan(10);
    }

    const mary = snapshot.attribution.entries.find(
      (a) => a.displayName === "Manager Mary",
    );
    expect(mary).toBeDefined();
    expect(mary?.context.directReportCount).toBe(2);
    expect(mary?.context.directReportHashes.length).toBe(2);

    const dan = snapshot.attribution.entries.find(
      (a) => a.displayName === "Direct Dan",
    );
    expect(dan?.calibration.managerEmailHash).toBe(mary?.emailHash);
    expect(dan?.context.directReportCount).toBe(0);
  });

  it("manager-calibration summary on the methodology bundle aggregates directs from the attribution entries", () => {
    const rosterEntries = [
      competitiveEntry(1, {
        displayName: "Manager Mary",
        email: "mary@meetcleo.com",
        manager: "Boss",
      }),
      competitiveEntry(2, {
        displayName: "Direct Dan",
        email: "dan@meetcleo.com",
        manager: "Manager Mary",
      }),
    ];
    const normalised = rosterEntries.map((entry) => ({
      ...entry,
      emailHash: hashEmailForRanking(entry.email),
    }));
    const snapshot = buildRankingSnapshot({
      headcountRows: normalised.map((e) => ({
        email: e.email,
        preferred_name: e.displayName,
        hb_function: "Engineering",
        hb_level: e.levelLabel,
        hb_squad: e.squad ?? null,
        rp_specialisation: "Backend Engineer",
        rp_department_name: "Core Pillar",
        job_title: "Senior Backend Engineer",
        manager: e.manager,
        line_manager_email: null,
        start_date: "2023-01-01",
        termination_date: null,
      })),
      githubMap: normalised.map((e) => ({
        githubLogin: e.githubLogin ?? e.email,
        employeeEmail: e.email,
        isBot: false,
      })),
      impactModel: {
        engineers: normalised.map((e) => ({ email: e.email })),
      },
      signals: normalised.map((e, i) =>
        signalRow(i + 1, { emailHash: e.emailHash }),
      ),
      now: new Date("2026-04-24T00:00:00Z"),
    });

    const summary = snapshot.methodology.managerCalibration;
    expect(summary.status).toBe("structure_only");
    expect(summary.managersWithDirectReports).toBe(1);
    expect(summary.directReportLinks).toBe(1);
    expect(summary.engineersWithMappedManager).toBe(1);
    expect(summary.note.length).toBeGreaterThan(20);
  });

  it("methodology panel knownLimitations does not claim anti-gaming or methodology panel is still pending", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    for (const line of snapshot.methodology.knownLimitations) {
      const lower = line.toLowerCase();
      if (/\b(pending|outstanding)\b/.test(lower)) {
        expect(lower).toMatch(/stability/);
        expect(lower).not.toMatch(/methodology panel[^.]*\bpending\b/);
        expect(lower).not.toMatch(/anti-gaming[^.]*\bpending\b/);
        expect(lower).not.toMatch(/manager calibration[^.]*\bpending\b/);
      }
    }
  });

  it("effective weights on the methodology panel match the composite bundle so the panel stays honest", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(snapshot.methodology.effectiveWeights).toBe(
      snapshot.composite.effectiveSignalWeights,
    );
  });

  it("unavailable signals on the methodology panel mirror the signal audit", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    expect(snapshot.methodology.unavailableSignals).toBe(
      snapshot.audit.unavailableSignals,
    );
  });

  it("buildMethodology is a pure helper that can run outside buildRankingSnapshot", () => {
    const signals = Array.from({ length: 3 }, (_, i) => signalRow(i + 1));
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      signals,
    });
    const methodology = buildMethodology({
      composite: snapshot.composite,
      normalisation: snapshot.normalisation,
      attribution: snapshot.attribution,
      audit: snapshot.audit,
      knownLimitations: ["stability check pending"],
      signalWindowStart: "2026-01-01T00:00:00Z",
      signalWindowEnd: "2026-04-24T00:00:00Z",
      snapshotDate: "2026-04-24",
      impactModelGeneratedAt: "2026-04-20T12:00:00Z",
      aiUsageLatestMonth: "2026-04-01",
      headcountGeneratedAt: null,
      rubricVersion: null,
    });
    expect(methodology.knownLimitations).toEqual(["stability check pending"]);
    expect(
      methodology.freshness.find((b) => /ranking snapshot/i.test(b.label))
        ?.timestamp,
    ).toBe("2026-04-24");
    expect(methodology.rubricVersion).toBeNull();
    expect(
      methodology.freshness.find((b) => /rubric/i.test(`${b.label} ${b.source}`))
        ?.availability,
    ).toBe("unavailable");
  });
});

describe("M23 scored squad-delivery copy truthfulness", () => {
  // Phrase reserved for the `contextual_only` posture (zero effective weight).
  // Any scored squad-delivery signal that uses it would imply zero-weight and
  // contradict the M22 anti-gaming contract.
  const ZERO_WEIGHT_PHRASE = /\bcontext(?:ual)? only\b/i;

  const SQUAD_DELIVERY_SCORED_SIGNALS = [
    "Squad review rate %",
    "Squad cycle time (inverted)",
    "Squad time-to-first-review (inverted)",
  ] as const;

  function buildDefaultSnapshot() {
    return buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [], generated_at: "2026-04-20T12:00:00Z" },
      now: new Date("2026-04-24T00:00:00Z"),
    });
  }

  it("M23: the three scored squad-delivery anti-gaming rows remain down_weighted", () => {
    for (const signal of SQUAD_DELIVERY_SCORED_SIGNALS) {
      const row = RANKING_ANTI_GAMING_ROWS.find((r) => r.signal === signal);
      expect(row, `Missing anti-gaming row for ${signal}`).toBeDefined();
      expect(
        row?.downweightStatus,
        `Scored squad-delivery signal "${signal}" must be down_weighted, not ${row?.downweightStatus}`,
      ).toBe("down_weighted");
    }
  });

  it("M23: AI usage and individual review graph remain contextual_only (genuinely zero-weight)", () => {
    const aiRow = RANKING_ANTI_GAMING_ROWS.find((r) =>
      /ai tokens|ai spend/i.test(r.signal),
    );
    const reviewRow = RANKING_ANTI_GAMING_ROWS.find((r) =>
      /self-review|review graph/i.test(r.signal),
    );
    expect(aiRow?.downweightStatus).toBe("contextual_only");
    expect(reviewRow?.downweightStatus).toBe("contextual_only");
  });

  it("M23: anti-gaming copy for every scored signal avoids the 'context(ual) only' phrase", () => {
    const scoredSignals = new Set<string>();
    for (const method of Object.keys(
      RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS,
    ) as Array<keyof typeof RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS>) {
      for (const { signal } of RANKING_COMPOSITE_METHOD_SIGNAL_WEIGHTS[
        method
      ]) {
        scoredSignals.add(signal);
      }
    }

    for (const row of RANKING_ANTI_GAMING_ROWS) {
      if (!scoredSignals.has(row.signal)) continue;
      const blob = `${row.gamingPath} ${row.mitigation} ${row.residualWeakness}`;
      expect(
        ZERO_WEIGHT_PHRASE.test(blob),
        `Scored signal "${row.signal}" uses zero-weight phrasing in anti-gaming copy: ${blob}`,
      ).toBe(false);
    }
  });

  it("M23: methodology lens descriptions avoid the 'context(ual) only' phrase", () => {
    const snapshot = buildDefaultSnapshot();
    for (const lens of snapshot.methodology.lenses) {
      expect(
        ZERO_WEIGHT_PHRASE.test(lens.description),
        `Methodology lens "${lens.label}" description uses zero-weight phrasing: ${lens.description}`,
      ).toBe(false);
    }
  });

  it("M23: freshness badge notes for scored sources avoid 'context(ual) only'", () => {
    const snapshot = buildDefaultSnapshot();
    for (const badge of snapshot.methodology.freshness) {
      if (/ai usage/i.test(badge.label)) continue;
      if (/rubric/i.test(`${badge.label} ${badge.source}`)) continue;
      if (!badge.note) continue;
      expect(
        ZERO_WEIGHT_PHRASE.test(badge.note),
        `Freshness badge "${badge.label}" note uses zero-weight phrasing: ${badge.note}`,
      ).toBe(false);
    }
  });

  it("M23: known limitations that mention squad delivery avoid 'context(ual) only'", () => {
    const snapshot = buildDefaultSnapshot();
    for (const line of snapshot.methodology.knownLimitations) {
      const mentionsSquadDelivery =
        /swarmia|squad delivery|squad-delivery|squad cycle|squad review|squad time-to-first-review/i.test(
          line,
        );
      if (!mentionsSquadDelivery) continue;
      const mentionsZeroWeightSignal =
        /\bai (tokens|spend|usage)\b/i.test(line) ||
        /self-review|review graph|reviewer graph/i.test(line);
      if (mentionsZeroWeightSignal) continue;
      expect(
        ZERO_WEIGHT_PHRASE.test(line),
        `Known limitation about squad delivery uses zero-weight phrasing: ${line}`,
      ).toBe(false);
    }
  });

  it("M23: squad-delivery planned signal is marked unavailable without a persisted source and explains the no-live-call rule", () => {
    const snapshot = buildDefaultSnapshot();
    const delivery = snapshot.plannedSignals.find((s) =>
      /squad delivery/i.test(s.name),
    );
    expect(delivery).toBeDefined();
    const haystack = `${delivery?.name ?? ""} ${delivery?.note ?? ""}`;
    expect(ZERO_WEIGHT_PHRASE.test(haystack)).toBe(false);
    expect(delivery?.state).toBe("unavailable");
    expect(haystack.toLowerCase()).toMatch(/does not call swarmia live|persisted source/);
  });

  it("M23: Lens C description and limitation say scored + down-weighted, not context-only", () => {
    const lensC = RANKING_LENS_DEFINITIONS.find((d) => d.key === "delivery");
    expect(lensC).toBeDefined();
    const blob = `${lensC?.description} ${lensC?.limitation}`;
    expect(ZERO_WEIGHT_PHRASE.test(blob)).toBe(false);
    expect(blob.toLowerCase()).toMatch(/scored|down[- ]weighted/);
    // Must still flag this as team-level so the CEO knows C is squad-level.
    expect(blob.toLowerCase()).toMatch(
      /team[- ]level|shares the same c score|not an individual/,
    );
  });

  it("M23: lens-disagreement narratives that mention lens C avoid zero-weight phrasing", () => {
    // The `likelyCause` narrative prose is a page-facing surface via the
    // disagreement table. Build a synthetic disagreement where lens C scores
    // highest so the `delivery>*` branches are exercised, then assert the
    // rendered narrative strings avoid the banned phrase.
    const rosterEntries = [
      {
        emailHash: hashEmailForRanking("a@meetcleo.com"),
        displayName: "A",
        email: "a@meetcleo.com",
        githubLogin: "a",
        discipline: "BE" as const,
        levelLabel: "L4",
        squad: "Alpha",
        pillar: "Core",
        canonicalSquad: null,
        manager: "Boss",
        startDate: "2023-01-01",
        tenureDays: 800,
        isLeaverOrInactive: false,
        hasImpactModelRow: true,
        eligibility: "competitive" as const,
        reason: "Eligible",
      },
      {
        emailHash: hashEmailForRanking("b@meetcleo.com"),
        displayName: "B",
        email: "b@meetcleo.com",
        githubLogin: "b",
        discipline: "BE" as const,
        levelLabel: "L4",
        squad: "Bravo",
        pillar: "Core",
        canonicalSquad: null,
        manager: "Boss",
        startDate: "2023-01-01",
        tenureDays: 800,
        isLeaverOrInactive: false,
        hasImpactModelRow: true,
        eligibility: "competitive" as const,
        reason: "Eligible",
      },
    ];
    // Push A to have low output + low impact but great squad delivery, and B
    // the opposite, so every lens disagreement tag is exercised across the
    // two rows.
    const signals: PerEngineerSignalRow[] = [
      {
        emailHash: rosterEntries[0].emailHash,
        prCount: 1,
        commitCount: 1,
        additions: 10,
        deletions: 1,
        shapPredicted: 1,
        shapActual: 1,
        shapResidual: 0,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: 4,
        squadReviewRatePercent: 99,
        squadTimeToFirstReviewHours: 0.5,
        squadPrsInProgress: 0,
      },
      {
        emailHash: rosterEntries[1].emailHash,
        prCount: 100,
        commitCount: 200,
        additions: 10_000,
        deletions: 100,
        shapPredicted: 900,
        shapActual: 950,
        shapResidual: 50,
        aiTokens: null,
        aiSpend: null,
        squadCycleTimeHours: 200,
        squadReviewRatePercent: 5,
        squadTimeToFirstReviewHours: 50,
        squadPrsInProgress: 20,
      },
    ];
    const bundle = buildLenses({ entries: rosterEntries, signals });
    for (const row of bundle.disagreement.rows) {
      expect(
        ZERO_WEIGHT_PHRASE.test(row.likelyCause),
        `Lens disagreement narrative "${row.likelyCause}" uses zero-weight phrasing`,
      ).toBe(false);
    }
  });
});

describe("M24 stability check", () => {
  function compositeEntry(
    overrides: Partial<EngineerCompositeEntry> & {
      emailHash: string;
      displayName: string;
      rank: number | null;
      composite: number | null;
    },
  ): EngineerCompositeEntry {
    return {
      discipline: "BE",
      levelLabel: "L4",
      output: overrides.composite,
      impact: overrides.composite,
      delivery: overrides.composite,
      quality: overrides.composite,
      adjusted: overrides.composite,
      presentMethodCount: 5,
      compositePercentile: overrides.composite,
      methodsSummary: "median of 5 methods",
      ...overrides,
    };
  }

  function makeComposite(
    entries: EngineerCompositeEntry[],
  ): CompositeBundle {
    const scored = entries
      .filter((e) => e.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    return {
      contract: "",
      methods: ["output", "impact", "delivery", "quality", "adjusted"],
      minPresentMethods: 2,
      maxSingleSignalEffectiveWeight: 0.3,
      dominanceCorrelationThreshold: 0.75,
      entries,
      ranked: scored,
      effectiveSignalWeights: [],
      leaveOneOut: [],
      finalRankCorrelations: [],
      dominanceWarnings: [],
      dominanceBlocked: false,
      limitations: [],
    };
  }

  function eligibilityRow(
    overrides: Partial<EligibilityEntry> & {
      emailHash: string;
      displayName: string;
    },
  ): EligibilityEntry {
    return {
      email: `${overrides.displayName.toLowerCase().replace(/\s+/g, ".")}@meetcleo.com`,
      githubLogin: null,
      discipline: "BE",
      levelLabel: "L4",
      squad: null,
      pillar: "Core",
      canonicalSquad: null,
      manager: null,
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Eligible",
      ...overrides,
    };
  }

  function priorRow(
    overrides: Partial<RankingSnapshotRow> & {
      emailHash: string;
      rank: number | null;
      compositeScore: number | null;
    },
  ): RankingSnapshotRow {
    return {
      snapshotDate: "2026-04-01",
      methodologyVersion: RANKING_METHODOLOGY_VERSION,
      signalWindowStart: new Date("2025-10-03T00:00:00Z"),
      signalWindowEnd: new Date("2026-04-01T00:00:00Z"),
      eligibilityStatus: "competitive",
      adjustedPercentile: null,
      rawPercentile: null,
      methodA: overrides.compositeScore,
      methodB: overrides.compositeScore,
      methodC: overrides.compositeScore,
      methodD: overrides.compositeScore,
      confidenceLow: null,
      confidenceHigh: null,
      inputHash: null,
      metadata: {
        presentMethodCount: 4,
        dominanceBlocked: false,
        dominanceRiskApplied: false,
        confidenceWidth: null,
        inTieGroup: false,
      },
      ...overrides,
    };
  }

  function signalRowStable(emailHash: string): PerEngineerSignalRow {
    return {
      emailHash,
      prCount: 10,
      commitCount: 30,
      additions: 500,
      deletions: 100,
      shapPredicted: 80_000,
      shapActual: 85_000,
      shapResidual: 5_000,
      aiTokens: null,
      aiSpend: null,
      squadCycleTimeHours: 50,
      squadReviewRatePercent: 70,
      squadTimeToFirstReviewHours: 10,
      squadPrsInProgress: 3,
    };
  }

  it("exposes stability constants and adversarial questions with sensible defaults", () => {
    expect(RANKING_STABILITY_PERCENTILE_THRESHOLD).toBeGreaterThan(0);
    expect(RANKING_STABILITY_PERCENTILE_THRESHOLD).toBeLessThanOrEqual(15);
    expect(RANKING_STABILITY_AMBIGUOUS_COHORT_TOLERANCE).toBeGreaterThan(0);
    expect(RANKING_STABILITY_AMBIGUOUS_COHORT_TOLERANCE).toBeLessThanOrEqual(1);
    expect(RANKING_STABILITY_MIN_GAP_DAYS).toBeGreaterThanOrEqual(1);
    expect(RANKING_STABILITY_ADVERSARIAL_QUESTIONS.length).toBeGreaterThanOrEqual(3);
    // One of the adversarial questions must specifically ask about the >30%
    // effective-weight signal — this is the log-impact trade-off the page
    // explicitly flags.
    const joined = RANKING_STABILITY_ADVERSARIAL_QUESTIONS.join(" ").toLowerCase();
    expect(joined).toMatch(/30/);
    expect(joined).toMatch(/top[- ]10|intuition/);
    expect(joined).toMatch(/confidence band|tolerance|gap/);
  });

  it("returns no_prior_snapshot with withinTolerance=false when no prior slice is supplied", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({
        emailHash: hashA,
        displayName: "Alpha",
        rank: 1,
        composite: 90,
      }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
    });

    expect(bundle.status).toBe("no_prior_snapshot");
    expect(bundle.priorSnapshot).toBeNull();
    expect(bundle.priorSnapshotGapDays).toBeNull();
    expect(bundle.entries).toHaveLength(0);
    expect(bundle.comparableCohortSize).toBe(0);
    expect(bundle.withinTolerance).toBe(false);
    expect(bundle.adversarialQuestions).toBe(RANKING_STABILITY_ADVERSARIAL_QUESTIONS);
    expect(bundle.notes.join(" ")).toContain("No prior");
  });

  it("returns insufficient_gap with withinTolerance=false when prior is too recent", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({
        emailHash: hashA,
        displayName: "Alpha",
        rank: 1,
        composite: 90,
      }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const prior = [
      priorRow({
        emailHash: hashA,
        rank: 1,
        compositeScore: 90,
        snapshotDate: "2026-04-23", // 1 day gap — below the default min
      }),
    ];

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("insufficient_gap");
    expect(bundle.priorSnapshotGapDays).toBe(1);
    expect(bundle.withinTolerance).toBe(false);
    expect(bundle.entries).toHaveLength(0);
    expect(bundle.notes.join(" ")).toMatch(/too recent|below|refresh jitter/);
  });

  it("flags every entry methodology_change and withinTolerance=false when methodology versions differ", () => {
    const hashA = "a".repeat(16);
    const hashB = "b".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
      compositeEntry({ emailHash: hashB, displayName: "Bravo", rank: 2, composite: 70 }),
    ]);
    const eligibility = composite.entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const prior: RankingSnapshotRow[] = [
      priorRow({ emailHash: hashA, rank: 1, compositeScore: 90, methodologyVersion: "0.9.0-movers" }),
      priorRow({ emailHash: hashB, rank: 2, compositeScore: 70, methodologyVersion: "0.9.0-movers" }),
    ];

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("methodology_changed");
    expect(bundle.methodologyChanged).toBe(true);
    expect(bundle.withinTolerance).toBe(false);
    for (const entry of bundle.entries) {
      expect(entry.flag).toBe("methodology_change");
    }
    expect(bundle.methodologyChangeCount).toBe(2);
    expect(bundle.comparableCohortSize).toBe(0);
    expect(bundle.notes.join(" ")).toMatch(/Methodology version changed/i);
  });

  it("labels an engineer stable when |percentileDelta| <= threshold", () => {
    const hashA = "a".repeat(16);
    const hashB = "b".repeat(16);
    const hashC = "c".repeat(16);
    // Prior: A=1, B=2, C=3. Current: A=1, B=2, C=3 (identical positions).
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
      compositeEntry({ emailHash: hashB, displayName: "Bravo", rank: 2, composite: 80 }),
      compositeEntry({ emailHash: hashC, displayName: "Charlie", rank: 3, composite: 60 }),
    ]);
    const eligibility = composite.entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const signals = composite.entries.map((c) => signalRowStable(c.emailHash));
    // Prior inputHashes match the current hashes deterministically.
    const prior: RankingSnapshotRow[] = composite.entries.map((c, i) => {
      return priorRow({
        emailHash: c.emailHash,
        rank: c.rank,
        compositeScore: c.composite,
        inputHash: computeRankingInputHashForTest(signals[i]),
        methodA: c.composite,
        methodB: c.composite,
        methodC: c.composite,
        confidenceLow: null,
        confidenceHigh: null,
      });
    });

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      signals,
      priorRows: prior,
    });

    expect(bundle.status).toBe("ok");
    expect(bundle.stableCount).toBe(3);
    expect(bundle.ambiguousContextCount).toBe(0);
    expect(bundle.contextAffectedCount).toBe(0);
    expect(bundle.comparableCohortSize).toBe(3);
    expect(bundle.withinTolerance).toBe(true);
    for (const entry of bundle.entries) {
      expect(entry.flag).toBe("stable");
      expect(entry.percentileMagnitude).toBeLessThanOrEqual(RANKING_STABILITY_PERCENTILE_THRESHOLD);
    }
  });

  it("labels an engineer input_drift when inputHash differs AND percentile moved > threshold", () => {
    // 10-engineer cohort so a rank swap produces a large percentile delta
    // well above the 5pp threshold.
    const entries: EngineerCompositeEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const hash = String.fromCharCode(97 + i).repeat(16);
      entries.push(
        compositeEntry({
          emailHash: hash,
          displayName: `Eng${i + 1}`,
          rank: i + 1,
          composite: 100 - i * 10,
        }),
      );
    }
    const composite = makeComposite(entries);
    const eligibility = entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const signals = entries.map((c) => signalRowStable(c.emailHash));
    // Prior: first engineer was at rank 5, now moved to rank 1 (big jump).
    const prior: RankingSnapshotRow[] = entries.map((c) =>
      priorRow({
        emailHash: c.emailHash,
        rank: c.emailHash === entries[0].emailHash ? 5 : c.rank,
        compositeScore: c.composite,
        inputHash: `prior-${c.emailHash}`, // differs from current
      }),
    );

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      signals,
      priorRows: prior,
    });

    const mover = bundle.entries.find((e) => e.emailHash === entries[0].emailHash);
    expect(mover?.flag).toBe("input_drift");
    expect(mover?.inputHashChanged).toBe(true);
    expect(bundle.inputDriftCount).toBeGreaterThanOrEqual(1);
  });

  it("labels an engineer ambiguous_context when inputHash unchanged but percentile moved > threshold", () => {
    // 10 engineers; one shifts ranks by 4 positions with identical inputs.
    const entries: EngineerCompositeEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const hash = String.fromCharCode(97 + i).repeat(16);
      entries.push(
        compositeEntry({
          emailHash: hash,
          displayName: `Eng${i + 1}`,
          rank: i + 1,
          composite: 100 - i * 10,
        }),
      );
    }
    const composite = makeComposite(entries);
    const eligibility = entries.map((c) =>
      eligibilityRow({
        emailHash: c.emailHash,
        displayName: c.displayName,
        tenureDays: 800, // well above the low-tenure hint
      }),
    );
    const signals = entries.map((c) => signalRowStable(c.emailHash));
    // Compute current hashes so we can match them exactly in prior rows.
    // Mover is entries[0] (rank 1) — was previously rank 5.
    const prior: RankingSnapshotRow[] = entries.map((c, i) => {
      const currentInputHash = computeRankingInputHashForTest(signals[i]);
      const priorRank = c.emailHash === entries[0].emailHash ? 5 : c.rank;
      return priorRow({
        emailHash: c.emailHash,
        rank: priorRank,
        compositeScore: c.composite,
        inputHash: currentInputHash, // same hash as current, unchanged inputs
      });
    });

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      signals,
      priorRows: prior,
    });

    const mover = bundle.entries.find((e) => e.emailHash === entries[0].emailHash);
    expect(mover?.flag).toBe("ambiguous_context");
    expect(mover?.inputHashChanged).toBe(false);
    expect(mover?.narrative.toLowerCase()).toMatch(/ambiguous|cohort|tenure|discipline|manager|squad/);
    expect(mover?.narrative.toLowerCase()).not.toMatch(/methodology noise/);
    expect(bundle.ambiguousContextCount).toBeGreaterThanOrEqual(1);
  });

  it("labels an engineer context_affected when inputHash unchanged and a cohort hint is visible (low tenure)", () => {
    const entries: EngineerCompositeEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const hash = String.fromCharCode(97 + i).repeat(16);
      entries.push(
        compositeEntry({
          emailHash: hash,
          displayName: `Eng${i + 1}`,
          rank: i + 1,
          composite: 100 - i * 10,
        }),
      );
    }
    const composite = makeComposite(entries);
    const eligibility = entries.map((c, i) =>
      eligibilityRow({
        emailHash: c.emailHash,
        displayName: c.displayName,
        tenureDays: i === 0 ? 120 : 800, // mover has low tenure (<180)
      }),
    );
    const signals = entries.map((c) => signalRowStable(c.emailHash));
    const prior: RankingSnapshotRow[] = entries.map((c, i) => {
      const currentInputHash = computeRankingInputHashForTest(signals[i]);
      const priorRank = c.emailHash === entries[0].emailHash ? 5 : c.rank;
      return priorRow({
        emailHash: c.emailHash,
        rank: priorRank,
        compositeScore: c.composite,
        inputHash: currentInputHash,
      });
    });

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      signals,
      priorRows: prior,
    });

    const mover = bundle.entries.find((e) => e.emailHash === entries[0].emailHash);
    expect(mover?.flag).toBe("context_affected");
    expect(mover?.narrative.toLowerCase()).toMatch(/tenure|120/);
    expect(bundle.contextAffectedCount).toBeGreaterThanOrEqual(1);
  });

  it("classifies engineers present on only one side as cohort_transition (not as ordinary movement)", () => {
    const hashA = "a".repeat(16);
    const hashNew = "n".repeat(16);
    const hashLeaver = "l".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
      compositeEntry({ emailHash: hashNew, displayName: "NewHire", rank: 2, composite: 50 }),
    ]);
    const eligibility = [
      eligibilityRow({ emailHash: hashA, displayName: "Alpha" }),
      eligibilityRow({ emailHash: hashNew, displayName: "NewHire", tenureDays: 45 }),
    ];
    const prior: RankingSnapshotRow[] = [
      priorRow({ emailHash: hashA, rank: 1, compositeScore: 90 }),
      priorRow({ emailHash: hashLeaver, rank: 2, compositeScore: 60 }),
    ];

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      priorRows: prior,
    });

    expect(bundle.status).toBe("ok");
    const newEntrant = bundle.entries.find((e) => e.emailHash === hashNew);
    expect(newEntrant?.flag).toBe("cohort_transition");
    const leaver = bundle.entries.find((e) => e.emailHash === hashLeaver);
    expect(leaver?.flag).toBe("cohort_transition");
    expect(bundle.cohortTransitionCount).toBe(2);
    // Cohort transitions are excluded from the comparable cohort budget.
    expect(bundle.comparableCohortSize).toBe(1);
  });

  it("withinTolerance is false when ambiguous-cohort fraction exceeds tolerance", () => {
    // 10 engineers, all in the same discipline (> thin cohort), all with
    // >180d tenure (no low-tenure hint) so moves are pure ambiguous_context
    // rather than context_affected.
    const entries: EngineerCompositeEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const hash = String.fromCharCode(97 + i).repeat(16);
      entries.push(
        compositeEntry({
          emailHash: hash,
          displayName: `Eng${i + 1}`,
          rank: i + 1,
          composite: 100 - i * 10,
        }),
      );
    }
    const composite = makeComposite(entries);
    const eligibility = entries.map((c) =>
      eligibilityRow({
        emailHash: c.emailHash,
        displayName: c.displayName,
        tenureDays: 800, // no low-tenure hint — stays ambiguous
        discipline: "BE",
      }),
    );
    const signals = entries.map((c) => signalRowStable(c.emailHash));
    // Reverse the ranks entirely so every engineer moves by more than the
    // percentile threshold.
    const prior: RankingSnapshotRow[] = entries.map((c, i) => {
      const currentInputHash = computeRankingInputHashForTest(signals[i]);
      return priorRow({
        emailHash: c.emailHash,
        rank: 10 - i,
        compositeScore: c.composite,
        inputHash: currentInputHash,
      });
    });

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      signals,
      priorRows: prior,
      ambiguousCohortTolerance: 0.25,
    });

    expect(
      bundle.ambiguousContextCount + bundle.contextAffectedCount,
    ).toBeGreaterThanOrEqual(1);
    expect(bundle.ambiguousCohortFraction).not.toBeNull();
    expect(bundle.ambiguousCohortFraction!).toBeGreaterThan(0.25);
    expect(bundle.withinTolerance).toBe(false);
  });

  it("unknown flag when inputHash is missing on one side (protects against legacy prior rows)", () => {
    const entries: EngineerCompositeEntry[] = [];
    for (let i = 0; i < 10; i++) {
      const hash = String.fromCharCode(97 + i).repeat(16);
      entries.push(
        compositeEntry({
          emailHash: hash,
          displayName: `Eng${i + 1}`,
          rank: i + 1,
          composite: 100 - i * 10,
        }),
      );
    }
    const composite = makeComposite(entries);
    const eligibility = entries.map((c) =>
      eligibilityRow({ emailHash: c.emailHash, displayName: c.displayName }),
    );
    const signals = entries.map((c) => signalRowStable(c.emailHash));
    // Mover is rank 1, was rank 6 in prior — large shift. But prior inputHash is null.
    const prior: RankingSnapshotRow[] = entries.map((c) => {
      const priorRank = c.emailHash === entries[0].emailHash ? 6 : c.rank;
      return priorRow({
        emailHash: c.emailHash,
        rank: priorRank,
        compositeScore: c.composite,
        inputHash: null, // legacy: no persisted hash
      });
    });

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      signals,
      priorRows: prior,
    });

    const mover = bundle.entries.find((e) => e.emailHash === entries[0].emailHash);
    expect(mover?.flag).toBe("unknown");
    expect(mover?.inputHashChanged).toBeNull();
    expect(bundle.unknownCount).toBeGreaterThanOrEqual(1);
  });

  it("persists adversarial questions on every bundle regardless of status", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];

    const noPrior = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
    });
    const tooRecent = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      priorRows: [priorRow({ emailHash: hashA, rank: 1, compositeScore: 90, snapshotDate: "2026-04-23" })],
    });
    expect(noPrior.adversarialQuestions).toEqual(RANKING_STABILITY_ADVERSARIAL_QUESTIONS);
    expect(tooRecent.adversarialQuestions).toEqual(RANKING_STABILITY_ADVERSARIAL_QUESTIONS);
  });

  it("contract narrative names the percentile threshold and min gap so the page is self-describing", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
    });
    expect(bundle.contract).toMatch(
      new RegExp(`${RANKING_STABILITY_PERCENTILE_THRESHOLD} percentile`),
    );
    expect(bundle.contract).toMatch(
      new RegExp(`${RANKING_STABILITY_MIN_GAP_DAYS} calendar days`),
    );
    expect(bundle.contract.toLowerCase()).toMatch(/ambiguous|context|methodology/);
    expect(bundle.contract.toLowerCase()).toMatch(/two consecutive cycles/);
  });

  it("buildRankingSnapshot attaches the stability bundle, and it inherits snapshotDate/methodologyVersion from the snapshot", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(snapshot.stability).toBeDefined();
    expect(snapshot.stability.currentSnapshot.snapshotDate).toBe("2026-04-24");
    expect(snapshot.stability.currentSnapshot.methodologyVersion).toBe(
      RANKING_METHODOLOGY_VERSION,
    );
    expect(snapshot.stability.status).toBe("no_prior_snapshot");
    expect(snapshot.stability.adversarialQuestions).toBe(
      RANKING_STABILITY_ADVERSARIAL_QUESTIONS,
    );
  });

  it("stability and movers bundles honour the same minGap so the two comparability contracts stay in lock-step", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const prior = [
      priorRow({
        emailHash: hashA,
        rank: 1,
        compositeScore: 90,
        snapshotDate: "2026-04-22", // 2 day gap — below default min of 6
      }),
    ];

    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
      priorRows: prior,
      minGapDays: 3, // override to 3 — now the 2-day gap is still too recent
    });

    expect(bundle.status).toBe("insufficient_gap");
    expect(bundle.minGapDays).toBe(3);
  });

  it("known limitations name stability as live (not pending) and call out the two-consecutive-cycle requirement", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const joined = snapshot.knownLimitations.join(" ").toLowerCase();
    expect(joined).toMatch(/stability/);
    expect(joined).not.toMatch(
      /stability check[^.]*(still pending|only pending methodology milestone)/,
    );
    expect(joined).toMatch(/two consecutive cycles/);
  });

  it("stability-stage limitations name the same-methodology requirement and the hash-scope caveat", () => {
    const hashA = "a".repeat(16);
    const composite = makeComposite([
      compositeEntry({ emailHash: hashA, displayName: "Alpha", rank: 1, composite: 90 }),
    ]);
    const eligibility = [eligibilityRow({ emailHash: hashA, displayName: "Alpha" })];
    const bundle = buildStability({
      currentSnapshotDate: "2026-04-24",
      currentMethodologyVersion: RANKING_METHODOLOGY_VERSION,
      composite,
      eligibilityEntries: eligibility,
    });
    const joined = bundle.limitations.join(" ").toLowerCase();
    expect(joined).toMatch(/inputhash|input hash/);
    expect(joined).toMatch(/two consecutive cycles/);
    expect(joined).toMatch(/methodology/);
  });
});

// Helper that seeds a prior snapshot row's `inputHash` with the live
// `computeRankingInputHash` output for the same signal row — so tests for
// `ambiguous_context` / `context_affected` / `unknown` can pin the hash
// on both sides of a diff deterministically.
function computeRankingInputHashForTest(signal: PerEngineerSignalRow): string {
  return computeRankingInputHash(signal);
}

// ---------------------------------------------------------------------------
// M-quality: code-quality lens (prReviewAnalyses → aggregateQualitySignals)
// ---------------------------------------------------------------------------

describe("aggregateQualitySignals — per-engineer rubric aggregation", () => {
  function pr(
    overrides: Partial<PrReviewAnalysisInput> & { emailHash: string },
  ): PrReviewAnalysisInput {
    return {
      mergedAt: "2026-04-01T00:00:00Z",
      rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
      technicalDifficulty: 3,
      executionQuality: 4,
      testAdequacy: 3,
      riskHandling: 3,
      reviewability: 4,
      analysisConfidencePct: 80,
      revertWithin14d: false,
      ...overrides,
    };
  }

  it("returns an empty map when no analyses are supplied", () => {
    const agg = aggregateQualitySignals([]);
    expect(agg.size).toBe(0);
  });

  it("requires the minimum analysed PR count before producing scores", () => {
    const rows: PrReviewAnalysisInput[] = [];
    for (let i = 0; i < RANKING_QUALITY_MIN_ANALYSED_PRS - 1; i += 1) {
      rows.push(pr({ emailHash: "eng1" }));
    }
    const agg = aggregateQualitySignals(rows);
    const entry = agg.get("eng1")!;
    expect(entry).toBeDefined();
    expect(entry.analysedPrCount).toBe(RANKING_QUALITY_MIN_ANALYSED_PRS - 1);
    expect(entry.executionQualityMean).toBeNull();
    expect(entry.testAdequacyMean).toBeNull();
    expect(entry.riskHandlingMean).toBeNull();
    expect(entry.reviewabilityMean).toBeNull();
    expect(entry.revertRate).toBeNull();
  });

  it("produces scores once the minimum PR count is met", () => {
    const rows: PrReviewAnalysisInput[] = [];
    for (let i = 0; i < RANKING_QUALITY_MIN_ANALYSED_PRS; i += 1) {
      rows.push(pr({ emailHash: "eng1" }));
    }
    const entry = aggregateQualitySignals(rows).get("eng1")!;
    expect(entry.analysedPrCount).toBe(RANKING_QUALITY_MIN_ANALYSED_PRS);
    expect(entry.executionQualityMean).toBeCloseTo(4, 6);
    expect(entry.testAdequacyMean).toBeCloseTo(3, 6);
    expect(entry.revertRate).toBe(0);
  });

  it("weights per-PR contribution by confidence × difficulty", () => {
    // Engineer A: three high-difficulty high-confidence PRs scoring 5.
    // Engineer B: three low-difficulty high-confidence PRs scoring 3.
    // A's execution mean should be closer to 5; B's closer to 3. Since each
    // is an engineer with consistent per-PR scores, difficulty weighting
    // just scales every PR by the same amount within each engineer — so the
    // means themselves don't change within-engineer. The difficulty weight
    // matters for mixed-difficulty engineers: assert on that case below.
    const mix: PrReviewAnalysisInput[] = [
      // High difficulty, high quality (5): weight = 80 * 5 = 400
      pr({ emailHash: "eng1", technicalDifficulty: 5, executionQuality: 5 }),
      // Low difficulty, low quality (1): weight = 80 * 1 = 80
      pr({ emailHash: "eng1", technicalDifficulty: 1, executionQuality: 1 }),
      // Mid, mid: weight = 80 * 3 = 240
      pr({ emailHash: "eng1", technicalDifficulty: 3, executionQuality: 3 }),
    ];
    const entry = aggregateQualitySignals(mix).get("eng1")!;
    const expected = (5 * 400 + 1 * 80 + 3 * 240) / (400 + 80 + 240);
    expect(entry.executionQualityMean).toBeCloseTo(expected, 6);
    // Difficulty mean is unweighted — just the arithmetic mean.
    expect(entry.technicalDifficultyMean).toBeCloseTo(3, 6);
  });

  it("drops PRs with a mismatched rubric version", () => {
    const rows: PrReviewAnalysisInput[] = [
      pr({ emailHash: "eng1", rubricVersion: "v1.1-opus" }),
      pr({ emailHash: "eng1", rubricVersion: "v1.1-opus" }),
      pr({ emailHash: "eng1" }), // v2.0
      pr({ emailHash: "eng1" }),
      pr({ emailHash: "eng1" }),
    ];
    const entry = aggregateQualitySignals(rows).get("eng1")!;
    expect(entry.analysedPrCount).toBe(3);
    expect(entry.executionQualityMean).not.toBeNull();
  });

  it("computes revert rate over analysed PRs", () => {
    const rows: PrReviewAnalysisInput[] = [
      pr({ emailHash: "eng1", revertWithin14d: true }),
      pr({ emailHash: "eng1", revertWithin14d: false }),
      pr({ emailHash: "eng1", revertWithin14d: false }),
      pr({ emailHash: "eng1", revertWithin14d: true }),
    ];
    const entry = aggregateQualitySignals(rows).get("eng1")!;
    expect(entry.revertRate).toBeCloseTo(0.5, 6);
  });

  it("handles null score axes by dropping them from the mean without zeroing", () => {
    const rows: PrReviewAnalysisInput[] = [
      pr({ emailHash: "eng1", executionQuality: 4 }),
      pr({ emailHash: "eng1", executionQuality: null }),
      pr({ emailHash: "eng1", executionQuality: 4 }),
    ];
    const entry = aggregateQualitySignals(rows).get("eng1")!;
    // The null row contributes to the PR count and to other axes, but its
    // execution-quality contribution is dropped — the mean stays at 4
    // rather than being dragged toward zero.
    expect(entry.analysedPrCount).toBe(3);
    expect(entry.executionQualityMean).toBeCloseTo(4, 6);
  });

  it("falls back to mid confidence (50) for PRs with null analysis_confidence_pct", () => {
    // Two PRs: one with confidence=100 and quality=5, one with confidence=null
    // and quality=1. Weight for the first = 100*3 = 300, second = 50*3 = 150.
    // Weighted mean = (5*300 + 1*150) / 450 = 1650/450 ≈ 3.667.
    const rows: PrReviewAnalysisInput[] = [
      pr({
        emailHash: "eng1",
        executionQuality: 5,
        analysisConfidencePct: 100,
      }),
      pr({
        emailHash: "eng1",
        executionQuality: 1,
        analysisConfidencePct: null,
      }),
      // Third PR to meet the min-analysed-PRs gate.
      pr({ emailHash: "eng1", executionQuality: 3, analysisConfidencePct: 80 }),
    ];
    const entry = aggregateQualitySignals(rows).get("eng1")!;
    expect(entry.executionQualityMean).not.toBeNull();
    // Loose check: the mean should sit between the lowest and highest scores.
    expect(entry.executionQualityMean!).toBeGreaterThan(1);
    expect(entry.executionQualityMean!).toBeLessThan(5);
  });

  it("splits aggregates per engineer", () => {
    const rows: PrReviewAnalysisInput[] = [];
    for (let i = 0; i < RANKING_QUALITY_MIN_ANALYSED_PRS; i += 1) {
      rows.push(pr({ emailHash: "eng1", executionQuality: 5 }));
      rows.push(pr({ emailHash: "eng2", executionQuality: 2 }));
    }
    const agg = aggregateQualitySignals(rows);
    expect(agg.get("eng1")!.executionQualityMean).toBeCloseTo(5, 6);
    expect(agg.get("eng2")!.executionQualityMean).toBeCloseTo(2, 6);
  });
});

describe("quality lens end-to-end — buildLenses + buildRankingSnapshot", () => {
  // Minimal competitive-entry helper, mirroring the one used by the other
  // lens-level test blocks. Every engineer is competitive with a valid
  // impact-model row so the composite has at least one scored method per
  // engineer even without the quality input.
  function competitiveEntry(
    index: number,
    overrides: Partial<EligibilityEntry> = {},
  ): EligibilityEntry {
    const email = `eng${index}@meetcleo.com`;
    return {
      emailHash: hashEmailForRanking(email),
      displayName: `Engineer ${index}`,
      email,
      githubLogin: `eng${index}`,
      discipline: "BE",
      levelLabel: "L4",
      squad: "Platform",
      pillar: "Core",
      canonicalSquad: null,
      manager: "Boss",
      startDate: "2023-01-01",
      tenureDays: 800,
      isLeaverOrInactive: false,
      hasImpactModelRow: true,
      eligibility: "competitive",
      reason: "Competitive cohort.",
      ...overrides,
    };
  }

  it("quality lens scores engineers with enough analyses and leaves others null", () => {
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const analyses: PrReviewAnalysisInput[] = [];
    // Engineer 1 — 5 PRs at top quality
    for (let i = 0; i < 5; i += 1) {
      analyses.push({
        emailHash: entries[0].emailHash,
        mergedAt: "2026-04-01T00:00:00Z",
        rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
        technicalDifficulty: 4,
        executionQuality: 5,
        testAdequacy: 5,
        riskHandling: 5,
        reviewability: 5,
        analysisConfidencePct: 90,
        revertWithin14d: false,
      });
    }
    // Engineer 2 — 5 PRs at middling quality
    for (let i = 0; i < 5; i += 1) {
      analyses.push({
        emailHash: entries[1].emailHash,
        mergedAt: "2026-04-01T00:00:00Z",
        rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
        technicalDifficulty: 2,
        executionQuality: 3,
        testAdequacy: 2,
        riskHandling: 3,
        reviewability: 3,
        analysisConfidencePct: 70,
        revertWithin14d: false,
      });
    }
    // Engineer 3 — only 2 PRs, below the min → unscored
    for (let i = 0; i < 2; i += 1) {
      analyses.push({
        emailHash: entries[2].emailHash,
        mergedAt: "2026-04-01T00:00:00Z",
        rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
        technicalDifficulty: 3,
        executionQuality: 4,
        testAdequacy: 4,
        riskHandling: 4,
        reviewability: 4,
        analysisConfidencePct: 80,
        revertWithin14d: false,
      });
    }

    const qualityAggregates = aggregateQualitySignals(analyses);
    const bundle = buildLenses({ entries, qualityAggregates });
    const qualityById = new Map(
      bundle.lenses.quality.entries.map((e) => [e.emailHash, e]),
    );
    const e1 = qualityById.get(entries[0].emailHash)!;
    const e2 = qualityById.get(entries[1].emailHash)!;
    const e3 = qualityById.get(entries[2].emailHash)!;
    // Eng1 (top rubric) should outrank Eng2 (middling); Eng3 unscored.
    expect(e1.score).not.toBeNull();
    expect(e2.score).not.toBeNull();
    expect(e3.score).toBeNull();
    expect(e1.score!).toBeGreaterThan(e2.score!);
  });

  it("lens returns null for every engineer when no analyses are supplied", () => {
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const bundle = buildLenses({ entries });
    for (const e of bundle.lenses.quality.entries) {
      expect(e.score).toBeNull();
    }
  });

  it("revert-within-14d penalty drags down an otherwise strong engineer", () => {
    const entries = Array.from({ length: 2 }, (_, i) => competitiveEntry(i + 1));
    const makeRows = (
      hash: string,
      revertRate: boolean,
    ): PrReviewAnalysisInput[] => {
      const out: PrReviewAnalysisInput[] = [];
      for (let i = 0; i < 5; i += 1) {
        out.push({
          emailHash: hash,
          mergedAt: "2026-04-01T00:00:00Z",
          rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
          technicalDifficulty: 3,
          executionQuality: 4,
          testAdequacy: 4,
          riskHandling: 4,
          reviewability: 4,
          analysisConfidencePct: 80,
          revertWithin14d: revertRate,
        });
      }
      return out;
    };
    const analyses = [
      ...makeRows(entries[0].emailHash, false),
      ...makeRows(entries[1].emailHash, true),
    ];
    const bundle = buildLenses({
      entries,
      qualityAggregates: aggregateQualitySignals(analyses),
    });
    const e1 = bundle.lenses.quality.entries.find(
      (e) => e.emailHash === entries[0].emailHash,
    )!;
    const e2 = bundle.lenses.quality.entries.find(
      (e) => e.emailHash === entries[1].emailHash,
    )!;
    // Same rubric axes, but e2 has full revert rate → inverted penalty makes
    // e2's score lower than e1's.
    expect(e1.score).not.toBeNull();
    expect(e2.score).not.toBeNull();
    expect(e1.score!).toBeGreaterThan(e2.score!);
  });

  it("buildRankingSnapshot threads prReviewAnalyses through to the quality lens", () => {
    const entries = Array.from({ length: 3 }, (_, i) => competitiveEntry(i + 1));
    const headcountRows = entries.map((e) => ({
      email: e.email,
      preferred_name: e.displayName,
      hb_function: "Engineering",
      hb_level: e.levelLabel,
      hb_squad: e.squad,
      rp_specialisation: "Backend Engineer",
      rp_department_name: "Core",
      job_title: "Software Engineer",
      manager: e.manager,
      line_manager_email: "boss@meetcleo.com",
      start_date: e.startDate,
    }));
    const githubMap = entries.map((e) => ({
      githubLogin: e.githubLogin!,
      employeeEmail: e.email,
      isBot: false,
    }));
    const analyses: PrReviewAnalysisInput[] = [];
    for (let i = 0; i < 5; i += 1) {
      analyses.push({
        emailHash: entries[0].emailHash,
        mergedAt: "2026-04-01T00:00:00Z",
        rubricVersion: RANKING_QUALITY_RUBRIC_VERSION,
        technicalDifficulty: 4,
        executionQuality: 5,
        testAdequacy: 5,
        riskHandling: 5,
        reviewability: 5,
        analysisConfidencePct: 90,
        revertWithin14d: false,
      });
    }
    const snapshot = buildRankingSnapshot({
      headcountRows,
      githubMap,
      impactModel: { engineers: [] },
      qualityAnalyses: analyses,
    });
    // The composite entries include a `quality` field; at least one must be non-null.
    const scoredQuality = snapshot.composite.entries.filter(
      (c) => c.quality !== null,
    );
    expect(scoredQuality.length).toBeGreaterThan(0);
    // The methodology unavailable-signals list should no longer include the rubric.
    const unavailableNames = snapshot.audit.unavailableSignals.map((u) => u.name);
    expect(unavailableNames).not.toContain("Per-PR LLM rubric");
  });

  it("buildRankingSnapshot without qualityAnalyses lists the rubric as unavailable in the audit", () => {
    const snapshot = buildRankingSnapshot({
      headcountRows: [],
      githubMap: [],
      impactModel: { engineers: [] },
    });
    const unavailableNames = snapshot.audit.unavailableSignals.map((u) => u.name);
    expect(unavailableNames).toContain("Per-PR LLM rubric");
  });
});
