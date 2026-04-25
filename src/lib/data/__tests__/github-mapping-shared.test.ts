import { describe, expect, it } from "vitest";
import {
  evaluateTenureCompat,
  jaroWinkler,
  normaliseForMatch,
  scoreCandidatesForEmployee,
  scoreNameSimilarity,
  type CandidateLogin,
} from "../github-mapping-shared";

function candidate(overrides: Partial<CandidateLogin> = {}): CandidateLogin {
  return {
    login: "test",
    githubName: null,
    avatarUrl: null,
    firstCommitAt: null,
    lastCommitAt: null,
    commitCount: 0,
    prCount: 0,
    ...overrides,
  };
}

describe("normaliseForMatch", () => {
  it("strips accents and lowercases", () => {
    expect(normaliseForMatch("Pávlo Liébiediév")).toBe("pavlo liebiediev");
  });

  it("collapses hyphens, underscores, and apostrophes to spaces", () => {
    expect(normaliseForMatch("alex-mura_d'angelo")).toBe("alex mura d angelo");
  });

  it("collapses repeated whitespace", () => {
    expect(normaliseForMatch("  Alex   Mura  ")).toBe("alex mura");
  });
});

describe("jaroWinkler", () => {
  it("returns 1 for identical strings", () => {
    expect(jaroWinkler("alex", "alex")).toBe(1);
  });

  it("returns 0 for fully disjoint strings", () => {
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });

  it("rewards shared prefixes", () => {
    const a = jaroWinkler("agnes krithiga", "agnes");
    const b = jaroWinkler("agnes krithiga", "krithiga");
    // Both share characters but shared prefix should boost the first.
    expect(a).toBeGreaterThan(b);
  });
});

describe("scoreNameSimilarity", () => {
  it("scores exact-name candidates near 100", () => {
    const score = scoreNameSimilarity("Alex Mura", "alex.mura@meetcleo.com", {
      login: "alex-mura",
      githubName: "Alex Mura",
    });
    expect(score).toBeGreaterThanOrEqual(95);
  });

  it("rewards login-equals-email-prefix even without a display name", () => {
    const score = scoreNameSimilarity("Agnes Krithiga", "agnes@meetcleo.com", {
      login: "agnes",
      githubName: null,
    });
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it("returns a low score for unrelated logins", () => {
    const score = scoreNameSimilarity("Alex Mura", "alex@meetcleo.com", {
      login: "zztop99",
      githubName: "ZZ Top",
    });
    expect(score).toBeLessThan(40);
  });

  it("handles accented names", () => {
    const score = scoreNameSimilarity("Pávlo Liébiediév", "pavlo@meetcleo.com", {
      login: "pavlo-liebiediev",
      githubName: "Pavlo Liebiediev",
    });
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("handles middle names via token-set overlap", () => {
    const score = scoreNameSimilarity(
      "Agnes Krithiga Francis Xavier",
      "agnes.k@meetcleo.com",
      {
        login: "agnes-xavier",
        githubName: "Agnes Xavier",
      }
    );
    // Two of four tokens overlap → at least the overlap component contributes.
    expect(score).toBeGreaterThan(40);
  });
});

describe("evaluateTenureCompat", () => {
  it("flags compatible when first commit is after start date", () => {
    const result = evaluateTenureCompat("2024-01-01", "2024-06-01");
    expect(result.flag).toBe("compatible");
    expect(result.multiplier).toBe(1);
  });

  it("flags compatible when first commit is within 60 days before start", () => {
    const result = evaluateTenureCompat("2024-03-01", "2024-02-01");
    expect(result.flag).toBe("compatible");
  });

  it("demotes when first commit predates start by 60-365 days", () => {
    const result = evaluateTenureCompat("2024-06-01", "2024-01-01");
    expect(result.flag).toBe("predates_start");
    expect(result.multiplier).toBe(0.4);
  });

  it("heavily demotes when first commit predates start by 1y+", () => {
    const result = evaluateTenureCompat("2026-01-01", "2018-01-01");
    expect(result.flag).toBe("long_predates_start");
    expect(result.multiplier).toBe(0.1);
  });

  it("returns unknown when no first commit is available", () => {
    const result = evaluateTenureCompat("2024-01-01", null);
    expect(result.flag).toBe("unknown");
    expect(result.multiplier).toBe(1);
  });

  it("returns unknown when start date is unparseable", () => {
    const result = evaluateTenureCompat("not-a-date", "2024-01-01");
    expect(result.flag).toBe("unknown");
  });
});

describe("scoreCandidatesForEmployee", () => {
  const newHire = {
    name: "Mick Horler",
    email: "mick@meetcleo.com",
    startDate: "2026-01-01",
  };

  it("ranks the obvious match above an unrelated long-tenured login", () => {
    const candidates = [
      candidate({
        login: "long-timer",
        githubName: "Old Person",
        firstCommitAt: "2018-01-01T00:00:00Z",
        commitCount: 5000,
      }),
      candidate({
        login: "mick-horler",
        githubName: "Mick Horler",
        firstCommitAt: "2026-01-15T00:00:00Z",
        commitCount: 12,
      }),
    ];
    const scored = scoreCandidatesForEmployee(newHire, candidates);
    expect(scored[0].login).toBe("mick-horler");
    expect(scored[0].tenureFlag).toBe("compatible");
  });

  it("does not exclude tenure-incompatible logins, but heavily demotes them", () => {
    const candidates = [
      candidate({
        login: "ancient-mick",
        githubName: "Mick Horler",
        firstCommitAt: "2017-01-01T00:00:00Z",
        commitCount: 100,
      }),
    ];
    const scored = scoreCandidatesForEmployee(newHire, candidates);
    expect(scored).toHaveLength(1);
    expect(scored[0].tenureFlag).toBe("long_predates_start");
    // Score is positive (still rankable / searchable) but heavily reduced.
    expect(scored[0].score).toBeGreaterThan(0);
    expect(scored[0].score).toBeLessThan(30);
  });

  it("includes activity in the composite so prolific accounts edge out silent ones at the same name match", () => {
    const candidates = [
      candidate({
        login: "mick-horler",
        githubName: "Mick Horler",
        firstCommitAt: "2026-01-15T00:00:00Z",
        commitCount: 1,
      }),
      candidate({
        login: "mick-horler-2",
        githubName: "Mick Horler",
        firstCommitAt: "2026-01-15T00:00:00Z",
        commitCount: 500,
      }),
    ];
    const scored = scoreCandidatesForEmployee(newHire, candidates);
    expect(scored[0].login).toBe("mick-horler-2");
  });

  it("returns candidates sorted descending by score", () => {
    const candidates = [
      candidate({ login: "zzz", githubName: "Random Person", firstCommitAt: "2026-02-01T00:00:00Z" }),
      candidate({ login: "mick-horler", githubName: "Mick Horler", firstCommitAt: "2026-01-15T00:00:00Z" }),
      candidate({ login: "mick", githubName: "Other Mick", firstCommitAt: "2026-01-15T00:00:00Z" }),
    ];
    const scored = scoreCandidatesForEmployee(newHire, candidates);
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
    }
  });

  it("attaches human-readable reasons", () => {
    const scored = scoreCandidatesForEmployee(newHire, [
      candidate({
        login: "mick-horler",
        githubName: "Mick Horler",
        firstCommitAt: "2026-01-15T00:00:00Z",
        commitCount: 100,
      }),
    ]);
    expect(scored[0].reasons.some((r) => r.includes("Strong name match"))).toBe(true);
    expect(scored[0].reasons.some((r) => r.includes("Commit history compatible"))).toBe(true);
    expect(scored[0].reasons.some((r) => r.includes("100 commits"))).toBe(true);
  });
});
