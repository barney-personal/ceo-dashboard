import { describe, expect, it } from "vitest";
import {
  activeUsersSchema,
  conversionCohortSchema,
  currentFteSchema,
  headcountSchema,
  kpiSpendQuerySchema,
  ltvMonthlySchema,
  monthlyRetentionSchema,
  subscriptionRetentionSchema,
  unitEcon36mLtvSchema,
  unitEconArpuSchema,
  unitEconCpaSchema,
  unitEconCvrSchema,
  userAcquisitionSchema,
  weeklyRetentionSchema,
} from "../mode-rows";

describe("mode row schemas", () => {
  describe("ltvMonthlySchema", () => {
    it("accepts a well-formed monthly LTV row", () => {
      const result = ltvMonthlySchema.safeParse({
        month: "2025-01-01",
        user_ltv_36m_actual: 123.45,
      });
      expect(result.success).toBe(true);
    });

    it("rejects a row without month", () => {
      const result = ltvMonthlySchema.safeParse({ user_ltv_36m_actual: 1 });
      expect(result.success).toBe(false);
    });

    it("rejects a row with non-numeric LTV", () => {
      const result = ltvMonthlySchema.safeParse({
        month: "2025-01-01",
        user_ltv_36m_actual: "abc",
      });
      expect(result.success).toBe(false);
    });

    it("accepts null LTV (Mode may emit null)", () => {
      const result = ltvMonthlySchema.safeParse({
        month: "2025-01-01",
        user_ltv_36m_actual: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("kpiSpendQuerySchema", () => {
    it("accepts a well-formed spend row", () => {
      const result = kpiSpendQuerySchema.safeParse({
        day: "2025-01-01",
        actual_or_target: "actual",
        spend: 1000,
        new_bank_connected_users: 50,
      });
      expect(result.success).toBe(true);
    });

    it("rejects a row where spend is a string", () => {
      const result = kpiSpendQuerySchema.safeParse({
        day: "2025-01-01",
        actual_or_target: "actual",
        spend: "oops",
        new_bank_connected_users: 50,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("activeUsersSchema", () => {
    it("accepts daus/waus/maus as numbers or null", () => {
      expect(
        activeUsersSchema.safeParse({
          date: "2025-01-01",
          daus: 1000,
          waus: 5000,
          maus: null,
        }).success,
      ).toBe(true);
    });

    it("rejects when date is missing", () => {
      expect(
        activeUsersSchema.safeParse({ daus: 1, waus: 1, maus: 1 }).success,
      ).toBe(false);
    });
  });

  describe("monthlyRetentionSchema", () => {
    it("accepts a well-formed cohort row", () => {
      expect(
        monthlyRetentionSchema.safeParse({
          cohort_month: "2024-03-01",
          activity_month: 3,
          maus: 200,
        }).success,
      ).toBe(true);
    });

    it("rejects a row without numeric activity_month", () => {
      expect(
        monthlyRetentionSchema.safeParse({
          cohort_month: "2024-03-01",
          activity_month: "3",
          maus: 200,
        }).success,
      ).toBe(false);
    });
  });

  describe("weeklyRetentionSchema", () => {
    it("accepts a well-formed weekly row", () => {
      expect(
        weeklyRetentionSchema.safeParse({
          cohort_week: "2024-01-01",
          relative_moving_week: 2,
          active_users_weekly: 42,
        }).success,
      ).toBe(true);
    });

    it("rejects when active_users_weekly is null", () => {
      expect(
        weeklyRetentionSchema.safeParse({
          cohort_week: "2024-01-01",
          relative_moving_week: 2,
          active_users_weekly: null,
        }).success,
      ).toBe(false);
    });
  });

  describe("subscriptionRetentionSchema", () => {
    it("accepts a valid subscription row", () => {
      expect(
        subscriptionRetentionSchema.safeParse({
          subscription_type: "Plus",
          subscriber_cohort: "2024-01-01",
          relative_month: 1,
          pct_retained: 0.8,
          base: 1000,
        }).success,
      ).toBe(true);
    });

    it("rejects when subscription_type is empty", () => {
      expect(
        subscriptionRetentionSchema.safeParse({
          subscription_type: "",
          subscriber_cohort: "2024-01-01",
          relative_month: 1,
          pct_retained: 0.8,
          base: 1000,
        }).success,
      ).toBe(false);
    });
  });

  describe("conversionCohortSchema", () => {
    it("accepts a valid conversion cohort row", () => {
      expect(
        conversionCohortSchema.safeParse({
          cohort: "2024-01-01",
          metric_window: "M6",
          total_users: 2000,
          pct_premium: 0.04,
          pct_plus: 0.02,
          pct_nitro: 0.01,
          pct_ai: null,
        }).success,
      ).toBe(true);
    });

    it("rejects when metric_window missing", () => {
      expect(
        conversionCohortSchema.safeParse({
          cohort: "2024-01-01",
          total_users: 2000,
        }).success,
      ).toBe(false);
    });
  });

  describe("userAcquisitionSchema", () => {
    it("accepts a valid row", () => {
      expect(
        userAcquisitionSchema.safeParse({
          month: "2025-01-01",
          new_bank_connected_users: 100,
        }).success,
      ).toBe(true);
    });

    it("rejects empty month", () => {
      expect(
        userAcquisitionSchema.safeParse({
          month: "",
          new_bank_connected_users: 100,
        }).success,
      ).toBe(false);
    });
  });

  describe("currentFteSchema", () => {
    it("accepts a well-formed Rev row", () => {
      expect(
        currentFteSchema.safeParse({
          employee_email: "alice@example.com",
          preferred_name: "Alice",
          employment_type: "Full-time",
          start_date: "2024-01-01",
          line_manager_email: "bob@example.com",
          pillar_name: "Engineering",
          squad_name: "Platform",
          function_name: "Engineering",
        }).success,
      ).toBe(true);
    });

    it("rejects when preferred_name is not a string", () => {
      expect(
        currentFteSchema.safeParse({
          employee_email: "alice@example.com",
          preferred_name: 42,
        }).success,
      ).toBe(false);
    });
  });

  describe("headcountSchema", () => {
    it("accepts a legacy headcount row", () => {
      expect(
        headcountSchema.safeParse({
          preferred_name: "Alice",
          email: "alice@example.com",
          job_title: "Engineer",
          hb_level: "L3",
          hb_squad: "Platform",
          hb_function: "Engineering",
          manager: "Bob",
          start_date: "2024-01-01",
          work_location: "London",
          lifecycle_status: "Employed",
          is_cleo_headcount: 1,
          termination_date: null,
        }).success,
      ).toBe(true);
    });

    it("rejects when lifecycle_status is missing", () => {
      expect(
        headcountSchema.safeParse({
          preferred_name: "Alice",
          email: "alice@example.com",
          is_cleo_headcount: 1,
        }).success,
      ).toBe(false);
    });
  });

  describe("unitEcon metric schemas", () => {
    it("36M LTV schema accepts a numeric row", () => {
      expect(
        unitEcon36mLtvSchema.safeParse({ user_pnl_36m: 150 }).success,
      ).toBe(true);
    });

    it("36M LTV schema rejects non-numeric", () => {
      expect(
        unitEcon36mLtvSchema.safeParse({ user_pnl_36m: "150" }).success,
      ).toBe(false);
    });

    it("ARPU schema accepts all required numeric fields", () => {
      expect(
        unitEconArpuSchema.safeParse({
          arpmau: 10,
          gross_margin: 0.5,
          contribution_margin: 0.3,
          mau: 1_000_000,
          monthly_revenue: 500_000,
        }).success,
      ).toBe(true);
    });

    it("ARPU schema rejects when a field is missing", () => {
      expect(
        unitEconArpuSchema.safeParse({
          arpmau: 10,
          gross_margin: 0.5,
          contribution_margin: 0.3,
        }).success,
      ).toBe(false);
    });

    it("CPA schema rejects empty time_period", () => {
      expect(
        unitEconCpaSchema.safeParse({ time_period: "", avg_cpa: 10 }).success,
      ).toBe(false);
    });

    it("CPA schema accepts a valid row", () => {
      expect(
        unitEconCpaSchema.safeParse({
          time_period: "Previous 365 days",
          avg_cpa: 10,
        }).success,
      ).toBe(true);
    });

    it("CVR schema accepts a valid row", () => {
      expect(
        unitEconCvrSchema.safeParse({ average_7d_plus_m11_cvr: 0.12 }).success,
      ).toBe(true);
    });

    it("CVR schema rejects when field missing", () => {
      expect(unitEconCvrSchema.safeParse({}).success).toBe(false);
    });
  });
});
