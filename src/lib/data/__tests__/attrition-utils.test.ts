import { describe, expect, it } from "vitest";
import { classifyTenureBucket } from "../attrition-utils";

describe("classifyTenureBucket", () => {
  it.each([
    ["< 1 Year", "sub1yr"],
    ["<1yr", "sub1yr"],
    ["< 1y", "sub1yr"],
    ["0-3m", "sub1yr"],
    ["3-6m", "sub1yr"],
    ["9-12m", "sub1yr"],
  ] as const)("classifies %s as <1yr", (bucket, expected) => {
    expect(classifyTenureBucket(bucket)).toBe(expected);
  });

  it.each([
    ["1+ Year", "over1yr"],
    ["> 1 Year", "over1yr"],
    [">1yr", "over1yr"],
    ["1 +", "over1yr"],
  ] as const)("classifies %s as >=1yr", (bucket, expected) => {
    expect(classifyTenureBucket(bucket)).toBe(expected);
  });

  it.each([
    ["", "unknown"],
    ["Unknown", "unknown"],
    ["???", "unknown"],
  ] as const)("classifies %s as unknown", (bucket, expected) => {
    expect(classifyTenureBucket(bucket)).toBe(expected);
  });

  it("is case-insensitive and trim-tolerant", () => {
    expect(classifyTenureBucket("  < 1 YEAR  ")).toBe("sub1yr");
    expect(classifyTenureBucket("  1+ YEAR  ")).toBe("over1yr");
  });
});
