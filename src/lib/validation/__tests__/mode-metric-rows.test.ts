import { afterEach, describe, expect, it, vi } from "vitest";

const { mockCaptureMessage } = vi.hoisted(() => ({
  mockCaptureMessage: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: mockCaptureMessage,
}));

import {
  arpuRowSchema,
  cpaRowSchema,
  cvrRowSchema,
  ltvRowSchema,
  validateMetricRow,
} from "../mode-metric-rows";

afterEach(() => {
  mockCaptureMessage.mockReset();
});

describe("validateMetricRow", () => {
  it("accepts numeric values and null passthroughs", () => {
    expect(
      validateMetricRow(
        arpuRowSchema,
        { arpmau: 12.5, gross_margin: null, contribution_margin: 0.3, mau: 1000, monthly_revenue: null },
        { queryName: "ARPU Annualized" }
      )
    ).toEqual({
      arpmau: 12.5,
      gross_margin: null,
      contribution_margin: 0.3,
      mau: 1000,
      monthly_revenue: null,
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("returns null and emits a tagged Sentry warning when a numeric field is a string", () => {
    const result = validateMetricRow(
      ltvRowSchema,
      { user_pnl_36m: "$123.45" },
      { queryName: "36M LTV", reportName: "Strategic Finance KPIs" }
    );

    expect(result).toBeNull();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = mockCaptureMessage.mock.calls[0];
    expect(message).toBe("Mode metric row validation failure");
    expect(options.level).toBe("warning");
    expect(options.tags.validation_failure).toBe("true");
    expect(options.tags.queryName).toBe("36M LTV");
    expect(options.tags.reportName).toBe("Strategic Finance KPIs");
    expect(options.extra.invalidFieldNames).toEqual(["user_pnl_36m"]);
    expect(typeof options.extra.issues).toBe("string");
  });

  it("reports only the offending field when other columns are valid", () => {
    // arpmau is correct; gross_margin is a string (the only bad field).
    // invalidFieldNames must not list arpmau/mau/etc.
    const result = validateMetricRow(
      arpuRowSchema,
      {
        arpmau: 10,
        gross_margin: "bad",
        contribution_margin: 0.2,
        mau: 100,
        monthly_revenue: 1000,
      },
      { queryName: "ARPU Annualized" },
    );

    expect(result).toBeNull();
    const [, options] = mockCaptureMessage.mock.calls[0];
    expect(options.extra.invalidFieldNames).toEqual(["gross_margin"]);
  });

  it("allows extra columns via passthrough", () => {
    const row = {
      average_7d_plus_m11_cvr: 0.12,
      // Mode sometimes returns debugging columns alongside the ones we read
      extra_debug_column: "ok",
    };
    expect(
      validateMetricRow(cvrRowSchema, row, { queryName: "M11 Plus CVR" })
    ).toMatchObject({ average_7d_plus_m11_cvr: 0.12 });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("rejects infinite numbers as invalid", () => {
    expect(
      validateMetricRow(
        cpaRowSchema,
        { avg_cpa: Number.POSITIVE_INFINITY },
        { queryName: "CPA" }
      )
    ).toBeNull();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });
});
