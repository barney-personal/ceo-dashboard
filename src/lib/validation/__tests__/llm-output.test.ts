import { describe, expect, it } from "vitest";
import {
  parsedOkrKrSchema,
  parsedOkrUpdateSchema,
  financialExtractSchema,
  summarizeZodIssues,
} from "../llm-output";

describe("parsedOkrKrSchema", () => {
  it("accepts a valid KR", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "Increase retention",
      name: "KR1: Retain 95% of users",
      rag: "green",
      metric: "95% vs 90% target",
    });
    expect(result.success).toBe(true);
  });

  it("accepts KR with null metric", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "Launch MVP",
      name: "KR1: Ship v1",
      rag: "not_started",
      metric: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts KR without metric field", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "Launch MVP",
      name: "KR1: Ship v1",
      rag: "amber",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty objective", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "   ",
      name: "KR1",
      rag: "green",
      metric: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "Objective",
      name: "",
      rag: "green",
      metric: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid rag value", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "Objective",
      name: "KR1",
      rag: "blue",
      metric: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string metric", () => {
    const result = parsedOkrKrSchema.safeParse({
      objective: "Objective",
      name: "KR1",
      rag: "green",
      metric: 42,
    });
    expect(result.success).toBe(false);
  });

  it("rejects completely wrong shape", () => {
    const result = parsedOkrKrSchema.safeParse("not an object");
    expect(result.success).toBe(false);
  });

  it("rejects null", () => {
    const result = parsedOkrKrSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

describe("parsedOkrUpdateSchema", () => {
  it("accepts a valid OKR update envelope", () => {
    const result = parsedOkrUpdateSchema.safeParse({
      squadName: "Growth",
      tldr: "Good progress",
      krs: [{ objective: "Obj1", name: "KR1", rag: "green" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts envelope without tldr", () => {
    const result = parsedOkrUpdateSchema.safeParse({
      squadName: "Growth",
      krs: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty squad name", () => {
    const result = parsedOkrUpdateSchema.safeParse({
      squadName: "   ",
      krs: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing krs array", () => {
    const result = parsedOkrUpdateSchema.safeParse({
      squadName: "Growth",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-object", () => {
    const result = parsedOkrUpdateSchema.safeParse(42);
    expect(result.success).toBe(false);
  });
});

describe("financialExtractSchema", () => {
  it("accepts a fully populated extract", () => {
    const result = financialExtractSchema.safeParse({
      period: "2026-02",
      periodLabel: "February 2026",
      revenue: 28.5,
      grossProfit: 22.9,
      grossMargin: 0.805,
      contributionProfit: 15.2,
      contributionMargin: 0.534,
      ebitda: -2.1,
      ebitdaMargin: -0.074,
      netIncome: -3.5,
      cashPosition: 120.0,
      cashBurn: -5.2,
      opex: 25.0,
      headcountCost: 18.0,
      marketingCost: 4.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an extract with all nulls", () => {
    const result = financialExtractSchema.safeParse({
      period: "2026-02",
      periodLabel: "February 2026",
      revenue: null,
      grossProfit: null,
      grossMargin: null,
      contributionProfit: null,
      contributionMargin: null,
      ebitda: null,
      ebitdaMargin: null,
      netIncome: null,
      cashPosition: null,
      cashBurn: null,
      opex: null,
      headcountCost: null,
      marketingCost: null,
    });
    expect(result.success).toBe(true);
  });

  it("defaults missing fields to null", () => {
    const result = financialExtractSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe("");
      expect(result.data.revenue).toBeNull();
    }
  });

  it("rejects period that doesn't match YYYY-MM", () => {
    const result = financialExtractSchema.safeParse({
      period: "Feb 2026",
      periodLabel: "February 2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects margins outside [-1, 1]", () => {
    const result = financialExtractSchema.safeParse({
      period: "2026-02",
      periodLabel: "February 2026",
      grossMargin: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity in numeric fields", () => {
    const result = financialExtractSchema.safeParse({
      period: "2026-02",
      periodLabel: "February 2026",
      revenue: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("rejects NaN in numeric fields", () => {
    const result = financialExtractSchema.safeParse({
      period: "2026-02",
      periodLabel: "February 2026",
      revenue: NaN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative margin outside bounds", () => {
    const result = financialExtractSchema.safeParse({
      period: "2026-02",
      periodLabel: "February 2026",
      ebitdaMargin: -1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("summarizeZodIssues", () => {
  it("formats multiple issues into a semicolon-separated string", () => {
    const result = parsedOkrKrSchema.safeParse({ rag: "blue" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const summary = summarizeZodIssues(result.error);
      expect(summary).toContain("objective");
      expect(summary).toContain("name");
      expect(summary).toContain("rag");
    }
  });
});
