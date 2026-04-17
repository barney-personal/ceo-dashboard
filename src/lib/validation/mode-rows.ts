import { z } from "zod";

/**
 * Zod schemas for Mode JSONB row shapes consumed by the data loaders.
 *
 * Mode columns are loosely typed and may arrive as `null`, so numeric
 * fields generally accept `number | null`. Schemas only enforce the fields
 * actually read by loaders; extra columns pass through via the default
 * `passthrough` behavior of `z.object().passthrough()`.
 */

const numericNullable = z.number().finite().nullable().optional();
const stringOrEmpty = z.string();

/** Strategic Finance KPIs — Query 4: monthly LTV. */
export const ltvMonthlySchema = z
  .object({
    month: z.string().min(1),
    user_ltv_36m_actual: numericNullable,
  })
  .passthrough();
export type LtvMonthlyRow = z.infer<typeof ltvMonthlySchema>;

/** Strategic Finance KPIs — Query 3: daily spend / CPA / new users. */
export const kpiSpendQuerySchema = z
  .object({
    day: z.string().min(1),
    actual_or_target: stringOrEmpty,
    spend: numericNullable,
    new_bank_connected_users: numericNullable,
  })
  .passthrough();
export type KpiSpendQueryRow = z.infer<typeof kpiSpendQuerySchema>;

/** App Active Users — dau-wau-mau query all time. */
export const activeUsersSchema = z
  .object({
    date: z.string().min(1),
    daus: numericNullable,
    waus: numericNullable,
    maus: numericNullable,
  })
  .passthrough();
export type ActiveUsersRow = z.infer<typeof activeUsersSchema>;

/** App Retention — Query 1: monthly cohorts. */
export const monthlyRetentionSchema = z
  .object({
    cohort_month: z.string().min(1),
    activity_month: z.number().finite(),
    maus: z.number().finite(),
  })
  .passthrough();
export type MonthlyRetentionRow = z.infer<typeof monthlyRetentionSchema>;

/** App Retention Weekly — Query 1: weekly cohorts. */
export const weeklyRetentionSchema = z
  .object({
    cohort_week: z.string().min(1),
    relative_moving_week: z.number().finite(),
    active_users_weekly: z.number().finite(),
  })
  .passthrough();
export type WeeklyRetentionRow = z.infer<typeof weeklyRetentionSchema>;

/** Retention Dashboard — Query 1: subscription retention cohorts. */
export const subscriptionRetentionSchema = z
  .object({
    subscription_type: z.string().min(1),
    subscriber_cohort: z.string().min(1),
    relative_month: z.number().finite(),
    pct_retained: z.number().finite(),
    base: z.number().finite().nullable().optional(),
  })
  .passthrough();
export type SubscriptionRetentionRow = z.infer<typeof subscriptionRetentionSchema>;

/** Premium Conversion — agg_cohort_conversion_rate_by_window. */
export const conversionCohortSchema = z
  .object({
    cohort: z.string().min(1),
    metric_window: z.string().min(1),
    total_users: numericNullable,
    pct_premium: numericNullable,
    pct_plus: numericNullable,
    pct_nitro: numericNullable,
    pct_ai: numericNullable,
  })
  .passthrough();
export type ConversionCohortRow = z.infer<typeof conversionCohortSchema>;

/** OKR Company Dashboard — User Acquisition. */
export const userAcquisitionSchema = z
  .object({
    month: z.string().min(1),
    new_bank_connected_users: numericNullable,
  })
  .passthrough();
export type UserAcquisitionRow = z.infer<typeof userAcquisitionSchema>;

/** Current FTEs report — canonical Rev org structure. */
export const currentFteSchema = z
  .object({
    employee_email: z.string(),
    preferred_name: z.string(),
    employment_type: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    line_manager_email: z.string().nullable().optional(),
    pillar_name: z.string().nullable().optional(),
    squad_name: z.string().nullable().optional(),
    function_name: z.string().nullable().optional(),
  })
  .passthrough();
export type CurrentFteRow = z.infer<typeof currentFteSchema>;

/** Headcount SSoT report — legacy augmentation source. */
export const headcountSchema = z
  .object({
    preferred_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    job_title: z.string().nullable().optional(),
    hb_level: z.string().nullable().optional(),
    rp_specialisation: z.string().nullable().optional(),
    hb_squad: z.string().nullable().optional(),
    hb_function: z.string().nullable().optional(),
    manager: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    work_location: z.string().nullable().optional(),
    lifecycle_status: z.string(),
    is_cleo_headcount: z.number().finite().nullable().optional(),
    termination_date: z.string().nullable().optional(),
  })
  .passthrough();
export type HeadcountRow = z.infer<typeof headcountSchema>;

/** Strategic Finance KPIs — 36M LTV single-row metric. */
export const unitEcon36mLtvSchema = z
  .object({
    user_pnl_36m: z.number().finite(),
  })
  .passthrough();
export type UnitEcon36mLtvRow = z.infer<typeof unitEcon36mLtvSchema>;

/** Strategic Finance KPIs — ARPU Annualized single-row metric. */
export const unitEconArpuSchema = z
  .object({
    arpmau: z.number().finite(),
    gross_margin: z.number().finite(),
    contribution_margin: z.number().finite(),
    mau: z.number().finite(),
    monthly_revenue: z.number().finite(),
  })
  .passthrough();
export type UnitEconArpuRow = z.infer<typeof unitEconArpuSchema>;

/** Strategic Finance KPIs — CPA. */
export const unitEconCpaSchema = z
  .object({
    time_period: z.string().min(1),
    avg_cpa: z.number().finite(),
  })
  .passthrough();
export type UnitEconCpaRow = z.infer<typeof unitEconCpaSchema>;

/** Strategic Finance KPIs — M11 Plus CVR, past 7 days. */
export const unitEconCvrSchema = z
  .object({
    average_7d_plus_m11_cvr: z.number().finite(),
  })
  .passthrough();
export type UnitEconCvrRow = z.infer<typeof unitEconCvrSchema>;
