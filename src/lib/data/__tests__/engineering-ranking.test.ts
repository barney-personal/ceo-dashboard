import { describe, expect, it } from "vitest";
import {
  RANKING_METHODOLOGY_VERSION,
  RANKING_RAMP_UP_DAYS,
  buildEligibleRoster,
  buildRankingSnapshot,
  getEngineeringRanking,
  hashEmailForRanking,
  type EligibilityGithubMapRow,
  type EligibilityHeadcountRow,
  type EligibilityImpactModelView,
  type EligibilityInputs,
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
