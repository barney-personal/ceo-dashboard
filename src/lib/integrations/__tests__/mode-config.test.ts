import { describe, expect, it } from "vitest";

import {
  buildModeExploreUrl,
  buildModeReportUrl,
  getChartEmbeds,
  getModeReportLink,
  getModeReportNamesByToken,
  getSyncEnabledModeReportControls,
  MODE_SYNC_PROFILES,
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

describe("getSyncEnabledModeReportControls", () => {
  const syncEnabledCount = MODE_SYNC_PROFILES.filter((p) => p.syncEnabled).length;

  it("returns all sync-enabled reports when no tokens are inactive (fresh-DB path)", () => {
    const controls = getSyncEnabledModeReportControls();
    expect(controls).toHaveLength(syncEnabledCount);
    // Every control must come from a syncEnabled profile
    for (const control of controls) {
      const profile = MODE_SYNC_PROFILES.find(
        (p) => p.reportToken === control.reportToken
      );
      expect(profile?.syncEnabled).toBe(true);
    }
  });

  it("returns the same list when passed an explicitly empty Set", () => {
    expect(getSyncEnabledModeReportControls(new Set())).toHaveLength(
      syncEnabledCount
    );
  });

  it("excludes a token that is marked inactive in the DB", () => {
    const first = getSyncEnabledModeReportControls()[0];
    const controls = getSyncEnabledModeReportControls(
      new Set([first.reportToken])
    );
    expect(controls).toHaveLength(syncEnabledCount - 1);
    expect(controls.find((c) => c.reportToken === first.reportToken)).toBeUndefined();
  });

  it("never includes sync-disabled profiles regardless of the inactive set", () => {
    const disabledToken = MODE_SYNC_PROFILES.find((p) => !p.syncEnabled)!.reportToken;
    // Even with an empty inactive set, disabled profiles must not appear
    const controls = getSyncEnabledModeReportControls();
    expect(controls.find((c) => c.reportToken === disabledToken)).toBeUndefined();
  });

  it("returns controls sorted by section then name", () => {
    const controls = getSyncEnabledModeReportControls();
    for (let i = 1; i < controls.length; i++) {
      const prev = controls[i - 1];
      const curr = controls[i];
      const sectionCmp = prev.section.localeCompare(curr.section);
      if (sectionCmp === 0) {
        expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);
      } else {
        expect(sectionCmp).toBeLessThan(0);
      }
    }
  });

  it("builds modeUrl from the report token", () => {
    const controls = getSyncEnabledModeReportControls();
    for (const control of controls) {
      expect(control.modeUrl).toBe(buildModeReportUrl(control.reportToken));
    }
  });
});

describe("getModeReportNamesByToken", () => {
  it("returns a map covering all profiles including sync-disabled ones", () => {
    const map = getModeReportNamesByToken();
    for (const profile of MODE_SYNC_PROFILES) {
      expect(map.get(profile.reportToken)).toBe(profile.name);
    }
  });

  it("returns a fresh map on each call", () => {
    const a = getModeReportNamesByToken();
    const b = getModeReportNamesByToken();
    expect(a).not.toBe(b);
  });
});
