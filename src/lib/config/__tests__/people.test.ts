import { describe, expect, it } from "vitest";
import { normalizeJobTitle, normalizeDepartment, resolveEngineerDiscipline, normalizeLevel } from "../people";

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
  describe("rp_specialisation (primary signal)", () => {
    it("uses Backend Engineer specialisation", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "SE3", "Backend Engineer")).toBe("Backend Engineer");
    });

    it("uses Frontend Engineer specialisation", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "SE4", "Frontend Engineer")).toBe("Frontend Engineer");
    });

    it("specialisation takes priority over level prefix", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "F4", "Backend Engineer")).toBe("Backend Engineer");
    });
  });

  describe("level prefix (fallback)", () => {
    it("refines with B-prefix level when no specialisation", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "B2")).toBe("Backend Engineer");
      expect(resolveEngineerDiscipline("Software Engineer", "B4")).toBe("Backend Engineer");
    });

    it("refines with BE-prefix level", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "BE1")).toBe("Backend Engineer");
    });

    it("refines with F-prefix level", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "F4")).toBe("Frontend Engineer");
    });

    it("keeps Software Engineer for SE-prefix levels", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "SE3")).toBe("Software Engineer");
      expect(resolveEngineerDiscipline("Software Engineer", "SE4")).toBe("Software Engineer");
    });

    it("keeps Software Engineer when level is empty", () => {
      expect(resolveEngineerDiscipline("Software Engineer", "")).toBe("Software Engineer");
    });
  });

  it("does not change non-Software Engineer titles", () => {
    expect(resolveEngineerDiscipline("Backend Engineer", "SE3")).toBe("Backend Engineer");
    expect(resolveEngineerDiscipline("Frontend Engineer", "B2")).toBe("Frontend Engineer");
    expect(resolveEngineerDiscipline("Product Manager", "B2", "Product Manager")).toBe("Product Manager");
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

describe("normalizeLevel", () => {
  it("normalizes SE-prefix to B for Backend Engineers", () => {
    expect(normalizeLevel("SE3", "Backend Engineer")).toBe("B3");
    expect(normalizeLevel("SE4", "Backend Engineer")).toBe("B4");
  });

  it("normalizes BE-prefix to B for Backend Engineers", () => {
    expect(normalizeLevel("BE1", "Backend Engineer")).toBe("B1");
  });

  it("normalizes DS-prefix to B for Backend Engineers", () => {
    expect(normalizeLevel("DS3", "Backend Engineer")).toBe("B3");
  });

  it("keeps B-prefix unchanged for Backend Engineers", () => {
    expect(normalizeLevel("B2", "Backend Engineer")).toBe("B2");
    expect(normalizeLevel("B4", "Backend Engineer")).toBe("B4");
  });

  it("normalizes SE-prefix to F for Frontend Engineers", () => {
    expect(normalizeLevel("SE3", "Frontend Engineer")).toBe("F3");
    expect(normalizeLevel("SE4", "Frontend Engineer")).toBe("F4");
  });

  it("normalizes FE-prefix to F for Frontend Engineers", () => {
    expect(normalizeLevel("FE2", "Frontend Engineer")).toBe("F2");
  });

  it("keeps F-prefix unchanged for Frontend Engineers", () => {
    expect(normalizeLevel("F4", "Frontend Engineer")).toBe("F4");
  });

  it("does not change levels for non-engineering titles", () => {
    expect(normalizeLevel("SE3", "Product Manager")).toBe("SE3");
    expect(normalizeLevel("B2", "Product Manager")).toBe("B2");
  });

  it("does not change levels for Software Engineer", () => {
    expect(normalizeLevel("SE3", "Software Engineer")).toBe("SE3");
  });

  it("returns empty string for empty level", () => {
    expect(normalizeLevel("", "Backend Engineer")).toBe("");
  });

  it("returns level unchanged if no numeric suffix", () => {
    expect(normalizeLevel("Manager", "Backend Engineer")).toBe("Manager");
  });
});
