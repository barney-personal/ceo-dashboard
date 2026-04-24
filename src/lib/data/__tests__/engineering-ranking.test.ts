import { describe, expect, it } from "vitest";
import {
  RANKING_DISAGREEMENT_MIN_LENSES,
  RANKING_LENS_DEFINITIONS,
  RANKING_LENS_TOP_N,
  RANKING_METHODOLOGY_VERSION,
  RANKING_MIN_OVERLAP_SAMPLES,
  RANKING_NOMINAL_SIGNAL_NAMES,
  RANKING_NUMERIC_SIGNAL_NAMES,
  RANKING_RAMP_UP_DAYS,
  buildEligibleRoster,
  buildLenses,
  buildRankingSnapshot,
  buildSignalAudit,
  buildSourceNotes,
  computeSpearmanRho,
  getEngineeringRanking,
  hashEmailForRanking,
  type EligibilityEntry,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilityImpactModelView,
  type EligibilityInputs,
  type EligibilitySquadsRegistryRow,
  type PerEngineerSignalRow,
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

  it("labels Swarmia DORA as squad context, not an individual signal", async () => {
    const { plannedSignals } = await getEngineeringRanking();
    const swarmia = plannedSignals.find((s) =>
      s.name.toLowerCase().includes("swarmia")
    );
    expect(swarmia).toBeDefined();
    expect(swarmia?.name.toLowerCase()).toContain("squad");
    expect(swarmia?.note).toBeTruthy();
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
        impactModel: { engineers: [{ email_hash: emailHash }] },
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

  it("exposes three lens definitions in fixed output/impact/delivery order", () => {
    expect(RANKING_LENS_DEFINITIONS.map((d) => d.key)).toEqual([
      "output",
      "impact",
      "delivery",
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
    ]);
    expect(snapshot.lenses.lenses.output.entries.length).toBe(1);
  });
});
