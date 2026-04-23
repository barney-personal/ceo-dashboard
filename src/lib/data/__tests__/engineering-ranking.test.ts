import { describe, expect, it } from "vitest";
import {
  RANKING_METHODOLOGY_VERSION,
  RANKING_RAMP_UP_DAYS,
  buildEligibleRoster,
  buildRankingSnapshot,
  buildSourceNotes,
  getEngineeringRanking,
  hashEmailForRanking,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilityImpactModelView,
  type EligibilityInputs,
  type EligibilitySquadsRegistryRow,
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
        squads: [squad({ name: "Platform" })],
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
