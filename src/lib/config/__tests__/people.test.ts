import { describe, expect, it } from "vitest";
import { normalizeJobTitle, normalizeDepartment, resolveEngineerDiscipline } from "../people";

describe("normalizeJobTitle", () => {
  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeJobTitle("")).toBe("");
    expect(normalizeJobTitle("   ")).toBe("");
  });

  describe("seniority stripping", () => {
    it("strips Senior prefix", () => {
      expect(normalizeJobTitle("Senior Product Manager")).toBe("Product Manager");
    });

    it("strips Junior prefix", () => {
      expect(normalizeJobTitle("Junior Designer")).toBe("Designer");
    });

    it("strips Graduate prefix", () => {
      expect(normalizeJobTitle("Graduate Analyst")).toBe("Analyst");
    });

    it("strips Grad prefix", () => {
      expect(normalizeJobTitle("Grad Analyst")).toBe("Analyst");
    });

    it("strips Lead prefix", () => {
      expect(normalizeJobTitle("Lead Product Designer")).toBe("Product Designer");
    });

    it("strips Staff prefix", () => {
      expect(normalizeJobTitle("Staff Engineer")).toBe("Software Engineer");
    });

    it("strips Principal prefix", () => {
      expect(normalizeJobTitle("Principal Engineer")).toBe("Software Engineer");
    });

    it("strips Associate prefix", () => {
      expect(normalizeJobTitle("Associate Product Manager")).toBe("Product Manager");
    });

    it("strips Intern prefix", () => {
      expect(normalizeJobTitle("Intern Designer")).toBe("Designer");
    });

    it("is case-insensitive for prefix matching", () => {
      expect(normalizeJobTitle("SENIOR product manager")).toBe("Product Manager");
      expect(normalizeJobTitle("senior product manager")).toBe("Product Manager");
    });

    it("does not strip prefix that is the entire title", () => {
      expect(normalizeJobTitle("Senior")).toBe("Senior");
    });
  });

  describe("engineering discipline", () => {
    it("maps Backend Engineer → Backend Engineer", () => {
      expect(normalizeJobTitle("Backend Engineer")).toBe("Backend Engineer");
    });

    it("maps Senior Backend Engineer → Backend Engineer", () => {
      expect(normalizeJobTitle("Senior Backend Engineer")).toBe("Backend Engineer");
    });

    it("maps Frontend Engineer → Frontend Engineer", () => {
      expect(normalizeJobTitle("Frontend Engineer")).toBe("Frontend Engineer");
    });

    it("maps Senior Frontend Engineer → Frontend Engineer", () => {
      expect(normalizeJobTitle("Senior Frontend Engineer")).toBe("Frontend Engineer");
    });

    it("maps Frontend Software Engineer → Frontend Engineer", () => {
      expect(normalizeJobTitle("Frontend Software Engineer")).toBe("Frontend Engineer");
    });

    it("maps Python Engineer → Backend Engineer", () => {
      expect(normalizeJobTitle("Python Engineer")).toBe("Backend Engineer");
    });

    it("maps Senior Python Engineer → Backend Engineer", () => {
      expect(normalizeJobTitle("Senior Python Engineer")).toBe("Backend Engineer");
    });

    it("maps Full Stack Engineer → Software Engineer", () => {
      expect(normalizeJobTitle("Full Stack Engineer")).toBe("Software Engineer");
    });

    it("maps Software Developer → Software Engineer", () => {
      expect(normalizeJobTitle("Software Developer")).toBe("Software Engineer");
    });

    it("maps bare Engineer → Software Engineer", () => {
      expect(normalizeJobTitle("Engineer")).toBe("Software Engineer");
    });
  });

  describe("data role consolidation", () => {
    it("maps Data Scientist → Machine Learning", () => {
      expect(normalizeJobTitle("Data Scientist")).toBe("Machine Learning");
    });

    it("maps Data Science → Machine Learning", () => {
      expect(normalizeJobTitle("Data Science")).toBe("Machine Learning");
    });

    it("maps Senior Data Scientist → Machine Learning", () => {
      expect(normalizeJobTitle("Senior Data Scientist")).toBe("Machine Learning");
    });

    it("maps Data Science Manager → Machine Learning Manager", () => {
      expect(normalizeJobTitle("Data Science Manager")).toBe("Machine Learning Manager");
    });

    it("preserves Analytics as-is (title-cased)", () => {
      expect(normalizeJobTitle("analytics")).toBe("Analytics");
    });

    it("preserves Machine Learning as-is (title-cased)", () => {
      expect(normalizeJobTitle("machine learning")).toBe("Machine Learning");
    });
  });

  describe("title casing", () => {
    it("title-cases a lowercase title", () => {
      expect(normalizeJobTitle("product manager")).toBe("Product Manager");
    });

    it("preserves known abbreviations in uppercase", () => {
      expect(normalizeJobTitle("PM")).toBe("PM");
      expect(normalizeJobTitle("qa engineer")).toBe("QA Engineer");
      expect(normalizeJobTitle("sre")).toBe("SRE");
      expect(normalizeJobTitle("devops engineer")).toBe("DEVOPS Engineer");
    });

    it("normalises mixed-case input", () => {
      expect(normalizeJobTitle("pRoDuCt DESIGNER")).toBe("Product Designer");
    });
  });

  describe("level suffix stripping", () => {
    it("strips II suffix", () => {
      expect(normalizeJobTitle("Software Engineer II")).toBe("Software Engineer");
    });

    it("strips III suffix", () => {
      expect(normalizeJobTitle("Product Manager III")).toBe("Product Manager");
    });

    it("strips II after seniority prefix is removed", () => {
      expect(normalizeJobTitle("Backend Engineer II")).toBe("Backend Engineer");
    });

    it("strips II from non-aliased titles", () => {
      expect(normalizeJobTitle("Talent Coordinator II")).toBe("Talent Coordinator");
    });
  });

  describe("UX/User Researcher consolidation", () => {
    it("maps UX Researcher → User Researcher", () => {
      expect(normalizeJobTitle("UX Researcher")).toBe("User Researcher");
    });

    it("maps Lead UX Researcher → User Researcher", () => {
      expect(normalizeJobTitle("Lead UX Researcher")).toBe("User Researcher");
    });

    it("maps Senior UX Researcher → User Researcher", () => {
      expect(normalizeJobTitle("Senior UX Researcher")).toBe("User Researcher");
    });

    it("preserves User Researcher as-is", () => {
      expect(normalizeJobTitle("User Researcher")).toBe("User Researcher");
    });
  });
});

describe("resolveEngineerDiscipline", () => {
  it("returns the canonical rp_specialisation value when present", () => {
    expect(resolveEngineerDiscipline("Software Engineer", "Backend Engineer")).toBe("Backend Engineer");
    expect(resolveEngineerDiscipline("Software Engineer", "Frontend Engineer")).toBe("Frontend Engineer");
    expect(resolveEngineerDiscipline("Software Engineer", "Machine Learning Engineer")).toBe("Machine Learning Engineer");
    expect(resolveEngineerDiscipline("Software Engineer", "Engineering Manager")).toBe("Engineering Manager");
  });

  it("applies aliases to rp_specialisation values", () => {
    expect(resolveEngineerDiscipline("Software Engineer", "Python Engineer")).toBe("Backend Engineer");
    expect(resolveEngineerDiscipline("Product Manager", "Data Scientist")).toBe("Machine Learning");
  });

  it("falls back to the normalised title when specialisation is missing", () => {
    expect(resolveEngineerDiscipline("Software Engineer", "")).toBe("Software Engineer");
    expect(resolveEngineerDiscipline("Backend Engineer")).toBe("Backend Engineer");
    expect(resolveEngineerDiscipline("Product Manager", undefined)).toBe("Product Manager");
  });

  it("trims whitespace-only specialisation", () => {
    expect(resolveEngineerDiscipline("Software Engineer", "   ")).toBe("Software Engineer");
  });
});

describe("normalizeDepartment", () => {
  it("returns department unchanged when job title is empty", () => {
    expect(normalizeDepartment("Data Science", "")).toBe("Data Science");
    expect(normalizeDepartment("Product", "")).toBe("Product");
  });

  it("passes through unaffected departments unchanged", () => {
    expect(normalizeDepartment("Engineering", "Software Engineer")).toBe("Engineering");
    expect(normalizeDepartment("Analytics", "Product Analyst")).toBe("Analytics");
    expect(normalizeDepartment("Machine Learning", "Machine Learning Engineer")).toBe("Machine Learning");
    expect(normalizeDepartment("Marketing", "Growth Marketer")).toBe("Marketing");
  });

  it("maps Data Science + ML title → Machine Learning", () => {
    expect(normalizeDepartment("Data Science", "Machine Learning Engineer")).toBe("Machine Learning");
    expect(normalizeDepartment("Data Science", "Machine Learning Ops Engineer")).toBe("Machine Learning");
    expect(normalizeDepartment("Data Science", "Head Of Machine Learning")).toBe("Machine Learning");
  });

  it("maps Data Science + Data Engineer → Machine Learning", () => {
    expect(normalizeDepartment("Data Science", "Data Engineer")).toBe("Machine Learning");
  });

  it("maps Data Science + analyst/analytics titles → Analytics", () => {
    expect(normalizeDepartment("Data Science", "Product Analyst")).toBe("Analytics");
    expect(normalizeDepartment("Data Science", "Analytics Engineer")).toBe("Analytics");
    expect(normalizeDepartment("Data Science", "Credit Risk Analyst")).toBe("Analytics");
    expect(normalizeDepartment("Data Science", "Head Of Analytics")).toBe("Analytics");
  });

  it("maps Data Science + other titles → Analytics as default", () => {
    expect(normalizeDepartment("Data Science", "Product Manager")).toBe("Analytics");
    expect(normalizeDepartment("Data Science", "Director Of Credit Strategy")).toBe("Analytics");
  });

  it("maps Product + analyst titles → Analytics", () => {
    expect(normalizeDepartment("Product", "Product Analyst")).toBe("Analytics");
  });

  it("maps Product + marketing titles → Marketing", () => {
    expect(normalizeDepartment("Product", "Product Marketing Lead")).toBe("Marketing");
  });

  it("maps Product + design titles → Experience", () => {
    expect(normalizeDepartment("Product", "Product Design Manager")).toBe("Experience");
  });

  it("keeps Product Manager in Product", () => {
    expect(normalizeDepartment("Product", "Product Manager")).toBe("Product");
  });

  it("keeps other Product roles in Product", () => {
    expect(normalizeDepartment("Product", "New Bets Lead")).toBe("Product");
    expect(normalizeDepartment("Product", "Product Director")).toBe("Product");
    expect(normalizeDepartment("Product", "VP Of Product")).toBe("Product");
  });
});

describe("normalizeDepartment (with rp_specialisation signal)", () => {
  it("uses rp_specialisation to split Data Science → Machine Learning", () => {
    expect(normalizeDepartment("Data Science", "", "Machine Learning Engineer")).toBe("Machine Learning");
    expect(normalizeDepartment("Data Science", "", "ML Ops Engineer")).toBe("Machine Learning");
    expect(normalizeDepartment("Data Science", "", "Head of Machine Learning")).toBe("Machine Learning");
  });

  it("uses rp_specialisation to send Data Science analysts → Analytics", () => {
    expect(normalizeDepartment("Data Science", "", "Product Analyst (Technical)")).toBe("Analytics");
    expect(normalizeDepartment("Data Science", "", "Analytics Engineer")).toBe("Analytics");
  });

  it("prefers specialisation over title when both are provided", () => {
    // Title says ML but specialisation is analyst → Analytics (specialisation wins)
    expect(normalizeDepartment("Data Science", "Machine Learning Engineer", "Product Analyst")).toBe("Analytics");
  });
});
