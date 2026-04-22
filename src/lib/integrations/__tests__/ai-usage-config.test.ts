import { describe, expect, it } from "vitest";
import {
  MODE_SYNC_PROFILES,
  MODE_CHART_EMBEDS,
  getModeReportLink,
  getModeSyncProfile,
} from "../mode-config";

describe("AI Model Usage Dashboard registration", () => {
  const REPORT_TOKEN = "ac8032a3cc89";

  it("is registered with the four expected queries", () => {
    const profile = getModeSyncProfile(REPORT_TOKEN);
    expect(profile).toBeDefined();
    expect(profile?.name).toBe("AI Model Usage Dashboard");
    expect(profile?.section).toBe("people");
    expect(profile?.category).toBe("ai-usage");
    expect(profile?.syncEnabled).toBe(true);

    const queryNames = profile?.queries.map((q) => q.name) ?? [];
    expect(queryNames).toEqual(
      expect.arrayContaining(["Query 1", "Query 3", "MoM Usage", "Overall Data"]),
    );
    expect(queryNames).toHaveLength(4);

    // All queries store the full row set — row counts are low (~1k total).
    for (const query of profile?.queries ?? []) {
      expect(query.storageWindow).toEqual({ kind: "all" });
    }
  });

  it("exposes a chart embed so the page can surface the Mode link", () => {
    const embed = MODE_CHART_EMBEDS.find(
      (e) => e.section === "people" && e.category === "ai-usage",
    );
    expect(embed).toBeDefined();
    expect(embed?.url).toContain(REPORT_TOKEN);
  });

  it("resolves the canonical Mode URL via getModeReportLink", () => {
    const url = getModeReportLink("people", "ai-usage");
    expect(url).toBe(`https://app.mode.com/cleoai/reports/${REPORT_TOKEN}`);
  });

  it("doesn't duplicate report tokens across profiles", () => {
    const tokens = MODE_SYNC_PROFILES.map((p) => p.reportToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
