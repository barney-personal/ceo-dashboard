import { describe, expect, it } from "vitest";

import {
  buildModeExploreUrl,
  buildModeReportUrl,
  getChartEmbeds,
  getModeReportLink,
} from "../mode-config";

describe("Mode config links", () => {
  it("builds a base report URL from the shared workspace slug", () => {
    expect(buildModeReportUrl("11c3172037ac")).toBe(
      "https://app.mode.com/cleoai/reports/11c3172037ac",
    );
  });

  it("builds explore URLs from the shared report URL helper", () => {
    expect(buildModeExploreUrl("11c3172037ac", "b834503b4991")).toBe(
      "https://app.mode.com/cleoai/reports/11c3172037ac/viz/b834503b4991/explore",
    );
  });

  it("derives report links from the shared report map", () => {
    expect(getModeReportLink("product", "active-users")).toBe(
      "https://app.mode.com/cleoai/reports/56f94e35c537",
    );
  });

  it("keeps chart embed URLs aligned with the shared report builders", () => {
    expect(getChartEmbeds("unit-economics", "kpis")[0]?.url).toBe(
      buildModeExploreUrl("11c3172037ac", "b834503b4991"),
    );
  });
});
