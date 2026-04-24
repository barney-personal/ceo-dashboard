import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const squads = pgTable("squads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  pillar: text("pillar").notNull(),
  channelId: text("channel_id"),
  pmName: text("pm_name"),
  pmSlackId: text("pm_slack_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const modeReports = pgTable("mode_reports", {
  id: serial("id").primaryKey(),
  reportToken: text("report_token").notNull().unique(),
  name: text("name").notNull(),
  section: text("section").notNull(), // 'unit-economics' | 'financial' | 'product' | 'okrs' | 'people'
  category: text("category"), // 'ltv', 'cac', 'revenue', etc.
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const modeReportData = pgTable(
  "mode_report_data",
  {
    id: serial("id").primaryKey(),
    reportId: integer("report_id")
      .references(() => modeReports.id, { onDelete: "cascade" })
      .notNull(),
    queryToken: text("query_token").notNull(),
    queryName: text("query_name").notNull(),
    data: jsonb("data").notNull(), // Array of row objects
    columns: jsonb("columns").notNull(), // Column metadata [{name, type}]
    rowCount: integer("row_count").notNull(), // Stored row count for backward compatibility
    sourceRowCount: integer("source_row_count").default(0).notNull(),
    storedRowCount: integer("stored_row_count").default(0).notNull(),
    truncated: boolean("truncated").default(false).notNull(),
    storageWindow: jsonb("storage_window"),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.reportId, table.queryToken),
    index("mode_report_data_report_synced_idx").on(table.reportId, table.syncedAt),
  ]
);

export const okrUpdates = pgTable(
  "okr_updates",
  {
    id: serial("id").primaryKey(),
    slackTs: text("slack_ts").notNull(),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name"),
    userId: text("user_id"),
    userName: text("user_name"),
    squadName: text("squad_name").notNull(),
    pillar: text("pillar"), // derived from channel name
    objectiveName: text("objective_name").notNull(),
    krName: text("kr_name").notNull(),
    status: text("status").notNull(), // on_track, at_risk, behind, not_started, completed
    actual: text("actual"),
    target: text("target"),
    tldr: text("tldr"),
    rawText: text("raw_text"),
    postedAt: timestamp("posted_at").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.slackTs, table.channelId, table.krName)]
);

export const financialPeriods = pgTable("financial_periods", {
  id: serial("id").primaryKey(),
  period: text("period").notNull().unique(), // "2026-02"
  periodLabel: text("period_label").notNull(), // "February 2026"
  slackFileId: text("slack_file_id").unique(),
  filename: text("filename"),
  revenue: numeric("revenue", { precision: 15, scale: 2 }),
  grossProfit: numeric("gross_profit", { precision: 15, scale: 2 }),
  grossMargin: numeric("gross_margin", { precision: 5, scale: 4 }),
  contributionProfit: numeric("contribution_profit", { precision: 15, scale: 2 }),
  contributionMargin: numeric("contribution_margin", { precision: 5, scale: 4 }),
  ebitda: numeric("ebitda", { precision: 15, scale: 2 }),
  ebitdaMargin: numeric("ebitda_margin", { precision: 5, scale: 4 }),
  netIncome: numeric("net_income", { precision: 15, scale: 2 }),
  cashPosition: numeric("cash_position", { precision: 15, scale: 2 }),
  cashBurn: numeric("cash_burn", { precision: 15, scale: 2 }),
  opex: numeric("opex", { precision: 15, scale: 2 }),
  headcountCost: numeric("headcount_cost", { precision: 15, scale: 2 }),
  marketingCost: numeric("marketing_cost", { precision: 15, scale: 2 }),
  rawData: jsonb("raw_data"),
  slackSummary: text("slack_summary"),
  postedAt: timestamp("posted_at"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const slackMemberSnapshots = pgTable(
  "slack_member_snapshots",
  {
    id: serial("id").primaryKey(),
    windowStart: timestamp("window_start").notNull(),
    windowEnd: timestamp("window_end").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    name: text("name"),
    username: text("username"),
    title: text("title"),
    accountType: text("account_type"),
    accountCreatedAt: timestamp("account_created_at"),
    claimedAt: timestamp("claimed_at"),
    deactivatedAt: timestamp("deactivated_at"),
    daysActive: integer("days_active").default(0).notNull(),
    daysActiveDesktop: integer("days_active_desktop").default(0).notNull(),
    daysActiveAndroid: integer("days_active_android").default(0).notNull(),
    daysActiveIos: integer("days_active_ios").default(0).notNull(),
    messagesPosted: integer("messages_posted").default(0).notNull(),
    messagesPostedInChannels: integer("messages_posted_in_channels").default(0).notNull(),
    reactionsAdded: integer("reactions_added").default(0).notNull(),
    lastActiveAt: timestamp("last_active_at"),
    lastActiveDesktopAt: timestamp("last_active_desktop_at"),
    lastActiveAndroidAt: timestamp("last_active_android_at"),
    lastActiveIosAt: timestamp("last_active_ios_at"),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
  },
  (table) => [
    unique("slack_member_snapshot_window_user_uniq").on(
      table.windowStart,
      table.windowEnd,
      table.slackUserId,
    ),
    index("slack_member_snapshots_window_idx").on(table.windowStart, table.windowEnd),
  ]
);

export const slackEmployeeMap = pgTable("slack_employee_map", {
  id: serial("id").primaryKey(),
  slackUserId: text("slack_user_id").notNull().unique(),
  slackUsername: text("slack_username"),
  slackName: text("slack_name"),
  employeeEmail: text("employee_email"), // lowercased; joins to SSoT row->>'email'
  employeeName: text("employee_name"),
  matchMethod: text("match_method").notNull(), // 'auto_username' | 'auto_name' | 'manual' | 'external' | 'unmatched'
  note: text("note"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncLog = pgTable(
  "sync_log",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull().default("mode"),
    trigger: text("trigger").notNull().default("system"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    status: text("status").notNull().default("queued"), // 'queued' | 'running' | 'success' | 'partial' | 'error' | 'cancelled'
    attempt: integer("attempt").default(1).notNull(),
    maxAttempts: integer("max_attempts").default(1).notNull(),
    heartbeatAt: timestamp("heartbeat_at"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    workerId: text("worker_id"),
    recordsSynced: integer("records_synced").default(0).notNull(),
    scope: jsonb("scope"),
    skipReason: text("skip_reason"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("sync_log_source_started_idx").on(table.source, table.startedAt),
    index("sync_log_source_completed_idx").on(table.source, table.completedAt),
    uniqueIndex("sync_log_active_source_idx")
      .on(table.source)
      .where(sql`${table.status} in ('queued', 'running')`),
  ]
);

export const debugLogs = pgTable("debug_logs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // "mode", "slack", "management-accounts", "system"
  event: text("event").notNull(), // "query_run_check", "sync_started", etc.
  level: text("level").notNull().default("info"), // "info", "warn", "error", "debug"
  data: jsonb("data"), // arbitrary structured data
  syncRunId: integer("sync_run_id"), // optional FK to sync_log
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    calendarEventId: text("calendar_event_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    location: text("location"),
    organizer: text("organizer"),
    attendees: jsonb("attendees"), // [{email, name, responseStatus}]
    recurringEventId: text("recurring_event_id"),
    htmlLink: text("html_link"),
    calendarId: text("calendar_id"),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.calendarEventId),
    index("meetings_start_time_idx").on(table.startTime),
  ]
);

export const meetingNotes = pgTable(
  "meeting_notes",
  {
    id: serial("id").primaryKey(),
    granolaMeetingId: text("granola_meeting_id").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary"),
    transcript: text("transcript"),
    actionItems: jsonb("action_items"), // [{text, assignee, done}]
    participants: jsonb("participants"), // [{name, email}]
    meetingDate: timestamp("meeting_date").notNull(),
    durationMinutes: integer("duration_minutes"),
    calendarEventId: text("calendar_event_id"), // link to meetings table
    syncedByUserId: text("synced_by_user_id"), // Clerk user ID — null = enterprise/shared
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [index("meeting_notes_date_idx").on(table.meetingDate)]
);

export const preReads = pgTable(
  "pre_reads",
  {
    id: serial("id").primaryKey(),
    slackTs: text("slack_ts").notNull(),
    channelId: text("channel_id").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    title: text("title"),
    content: text("content"),
    attachments: jsonb("attachments"), // [{name, url, mimeType}]
    meetingDate: timestamp("meeting_date"),
    postedAt: timestamp("posted_at").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.slackTs, table.channelId),
    index("pre_reads_posted_at_idx").on(table.postedAt),
  ]
);

// ---------------------------------------------------------------------------
// User integrations (per-user API keys for third-party services)
// ---------------------------------------------------------------------------

export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    provider: text("provider").notNull(), // "granola"
    apiKey: text("api_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.clerkUserId, table.provider)]
);

// ---------------------------------------------------------------------------
// GitHub engineering metrics
// ---------------------------------------------------------------------------

export const githubPrMetrics = pgTable(
  "github_pr_metrics",
  {
    id: serial("id").primaryKey(),
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
    prsCount: integer("prs_count").notNull().default(0),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changedFiles: integer("changed_files").notNull().default(0),
    repos: jsonb("repos").notNull(), // string[]
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.login, table.periodStart, table.periodEnd),
    index("github_pr_metrics_period_idx").on(table.periodStart, table.periodEnd),
  ]
);

export const githubPrs = pgTable(
  "github_prs",
  {
    id: serial("id").primaryKey(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    title: text("title").notNull(),
    authorLogin: text("author_login").notNull(),
    authorAvatarUrl: text("author_avatar_url"),
    mergedAt: timestamp("merged_at").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changedFiles: integer("changed_files").notNull().default(0),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.repo, table.prNumber),
    index("github_prs_merged_at_idx").on(table.mergedAt),
    index("github_prs_author_idx").on(table.authorLogin),
  ]
);

export const githubCommits = pgTable(
  "github_commits",
  {
    id: serial("id").primaryKey(),
    repo: text("repo").notNull(),
    sha: text("sha").notNull(),
    authorLogin: text("author_login").notNull(),
    authorAvatarUrl: text("author_avatar_url"),
    committedAt: timestamp("committed_at").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    message: text("message").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.repo, table.sha),
    index("github_commits_committed_at_idx").on(table.committedAt),
    index("github_commits_author_idx").on(table.authorLogin),
  ]
);

/**
 * Per-PR Claude analysis cache. Keyed by (repo, pr_number, rubric_version) so
 * a rubric change forces a re-analysis but the same PR isn't re-scored
 * repeatedly within a rubric version. Predictions and SHAP values live
 * elsewhere — this table only holds the LLM's structured judgement so the
 * `/dashboard/engineering/code-review` page can aggregate cheaply on load.
 */
export const prReviewAnalyses = pgTable(
  "pr_review_analyses",
  {
    id: serial("id").primaryKey(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number").notNull(),
    mergeSha: text("merge_sha"),
    authorLogin: text("author_login").notNull(),
    mergedAt: timestamp("merged_at").notNull(),
    // Scores: 1-5 integers. Enforced in application code only (see
    // "Known deliberate gaps" in CLAUDE.md for why no CHECK constraints).
    complexity: integer("complexity").notNull(),
    quality: integer("quality").notNull(),
    technicalDifficulty: integer("technical_difficulty").notNull().default(3),
    executionQuality: integer("execution_quality").notNull().default(3),
    testAdequacy: integer("test_adequacy").notNull().default(3),
    riskHandling: integer("risk_handling").notNull().default(3),
    reviewability: integer("reviewability").notNull().default(3),
    analysisConfidencePct: integer("analysis_confidence_pct").notNull().default(60),
    primarySurface: text("primary_surface").notNull().default("mixed"),
    category: text("category").notNull(), // bug_fix | feature | refactor | infra | test | docs | chore
    summary: text("summary").notNull(),
    // caveats is always supplied by upsertAnalysis — no DB default needed.
    caveats: jsonb("caveats").notNull(), // string[]
    standout: text("standout"), // notably_complex | notably_high_quality | notably_low_quality | concerning | null
    approvalCount: integer("approval_count").notNull().default(0),
    changeRequestCount: integer("change_request_count").notNull().default(0),
    reviewCommentCount: integer("review_comment_count").notNull().default(0),
    conversationCommentCount: integer("conversation_comment_count")
      .notNull()
      .default(0),
    reviewRounds: integer("review_rounds").notNull().default(0),
    timeToFirstReviewMinutes: integer("time_to_first_review_minutes"),
    timeToMergeMinutes: integer("time_to_merge_minutes").notNull().default(0),
    commitCount: integer("commit_count").notNull().default(0),
    commitsAfterFirstReview: integer("commits_after_first_review")
      .notNull()
      .default(0),
    revertWithin14d: boolean("revert_within_14d").notNull().default(false),
    outcomeScore: integer("outcome_score").notNull().default(75),
    reviewProvider: text("review_provider").notNull().default("anthropic"),
    reviewModel: text("review_model").notNull().default("claude-opus-4-7"),
    secondOpinionUsed: boolean("second_opinion_used").notNull().default(false),
    agreementLevel: text("agreement_level").notNull().default("single_model"),
    secondOpinionReasons: jsonb("second_opinion_reasons")
      .notNull()
      .default(sql`'[]'::jsonb`),
    rubricVersion: text("rubric_version").notNull(),
    rawJson: jsonb("raw_json").notNull(),
    analysedAt: timestamp("analysed_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.repo, table.prNumber, table.rubricVersion),
    index("pr_review_merged_at_idx").on(table.mergedAt),
    index("pr_review_author_idx").on(table.authorLogin),
  ],
);

export const githubEmployeeMap = pgTable("github_employee_map", {
  id: serial("id").primaryKey(),
  githubLogin: text("github_login").notNull().unique(),
  employeeName: text("employee_name"),
  employeeEmail: text("employee_email"),
  githubName: text("github_name"), // display name from GitHub profile
  matchMethod: text("match_method").notNull(), // 'auto' | 'manual'
  matchConfidence: text("match_confidence"), // 'high' | 'medium' | 'low'
  isBot: boolean("is_bot").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const syncPhases = pgTable("sync_phases", {
  id: serial("id").primaryKey(),
  syncLogId: integer("sync_log_id")
    .references(() => syncLog.id, { onDelete: "cascade" })
    .notNull(),
  phase: text("phase").notNull(),
  status: text("status").notNull().default("running"), // 'running' | 'success' | 'error' | 'skipped'
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  detail: text("detail"),
  itemsProcessed: integer("items_processed").default(0),
  errorMessage: text("error_message"),
});

// ---------------------------------------------------------------------------
// Page view tracking (dashboard usage analytics)
// ---------------------------------------------------------------------------

export const pageViews = pgTable(
  "page_views",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    path: text("path").notNull(),
    hourBucket: text("hour_bucket").notNull(), // "2026-04-10T14"
    viewedAt: timestamp("viewed_at").defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.clerkUserId, table.path, table.hourBucket),
    index("page_views_viewed_at_idx").on(table.viewedAt),
    index("page_views_user_viewed_idx").on(table.clerkUserId, table.viewedAt),
  ]
);

export const dashboardPermissionOverrides = pgTable(
  "dashboard_permission_overrides",
  {
    id: serial("id").primaryKey(),
    permissionId: text("permission_id").notNull().unique(),
    requiredRole: text("required_role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("dashboard_permission_overrides_role_idx").on(table.requiredRole),
  ]
);

// ---------------------------------------------------------------------------
// Production probes
// ---------------------------------------------------------------------------

export const probeRuns = pgTable(
  "probe_runs",
  {
    id: serial("id").primaryKey(),
    probeId: text("probe_id").notNull(),
    checkName: text("check_name").notNull(),
    status: text("status").notNull(), // 'green' | 'red' | 'timeout'
    latencyMs: integer("latency_ms").notNull(),
    detailsJson: jsonb("details_json"),
    runId: text("run_id"),
    target: text("target").notNull().default("prod"), // 'prod' | 'staging'
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("probe_runs_check_name_ts_idx").on(table.checkName, table.ts),
  ]
);

export const probeHeartbeats = pgTable("probe_heartbeats", {
  probeId: text("probe_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  version: text("version"),
});

export const probeIncidents = pgTable(
  "probe_incidents",
  {
    id: serial("id").primaryKey(),
    checkName: text("check_name").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    escalationLevel: integer("escalation_level").notNull().default(0),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
  },
  (table) => [
    // Prevents two open incidents for the same check under concurrent requests
    uniqueIndex("probe_incidents_open_uniq")
      .on(table.checkName)
      .where(sql`${table.closedAt} IS NULL`),
  ]
);

// ---------------------------------------------------------------------------
// Employee NPS (eNPS) — monthly full-screen takeover for happiness pulse
// ---------------------------------------------------------------------------

export const enpsResponses = pgTable(
  "enps_responses",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    month: text("month").notNull(), // "YYYY-MM"
    score: integer("score").notNull(), // 0-10
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // One submission per user per month
    unique("enps_responses_user_month_uniq").on(table.clerkUserId, table.month),
    index("enps_responses_month_idx").on(table.month),
    index("enps_responses_created_idx").on(table.createdAt),
  ]
);

export const enpsPrompts = pgTable(
  "enps_prompts",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    month: text("month").notNull(), // "YYYY-MM"
    skipCount: integer("skip_count").notNull().default(0),
    lastShownAt: timestamp("last_shown_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("enps_prompts_user_month_uniq").on(table.clerkUserId, table.month),
  ]
);

// ---------------------------------------------------------------------------
// Headcount forecast snapshots — used for forecast accuracy tracking.
// Snapshotted once per calendar month (idempotent) so we can compare past
// forecasts against actual headcount as months elapse.
// ---------------------------------------------------------------------------

export const headcountForecastSnapshots = pgTable(
  "headcount_forecast_snapshots",
  {
    id: serial("id").primaryKey(),
    /** YYYY-MM — the month when the forecast was captured. One row per
     *  calendar month enforced by the unique index below. */
    asOfMonth: text("as_of_month").notNull(),
    /** Timestamp of capture — useful when diagnosing late-month
     *  snapshots vs early-month ones. */
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
    /** Active FTE count at time of snapshot. */
    startingHeadcount: integer("starting_headcount").notNull(),
    /** Hire scenarios (P10/P50/P90 hires-per-month) used in the forecast. */
    hireScenarios: jsonb("hire_scenarios").notNull(), // { low, mid, high }
    /** Attrition rates used in the forecast (annualised). */
    attritionRates: jsonb("attrition_rates").notNull(), // { under1yrAnnual, over1yrAnnual }
    /** The monthly projection: [{month, low, mid, high, hires, departures, netChange}]. */
    projection: jsonb("projection").notNull(),
  },
  (table) => [
    unique("headcount_forecast_snapshot_month_uniq").on(table.asOfMonth),
    index("headcount_forecast_snapshot_captured_idx").on(table.capturedAt),
  ]
);

// ---------------------------------------------------------------------------
// Daily briefing cache — Claude-generated personalised briefing per user/day.
// Cached once per (email, date) so we pay the LLM cost at most once per user
// per UTC day. Bumping the model forces regeneration by failing the
// "model matches current" check in the loader.
// ---------------------------------------------------------------------------

export const userBriefings = pgTable(
  "user_briefings",
  {
    id: serial("id").primaryKey(),
    userEmail: text("user_email").notNull(), // lowercased
    briefingDate: text("briefing_date").notNull(), // YYYY-MM-DD (UTC)
    briefingText: text("briefing_text").notNull(),
    contextJson: jsonb("context_json").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheCreationTokens: integer("cache_creation_tokens"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("user_briefings_email_date_uniq").on(table.userEmail, table.briefingDate),
    index("user_briefings_date_idx").on(table.briefingDate),
  ],
);

// ---------------------------------------------------------------------------
// Engineering ranking snapshots
// ---------------------------------------------------------------------------
// Persisted per-engineer ranking rows keyed by `email_hash` only. Display
// name, email, manager, and resolved GitHub login are resolved at request
// time from Mode Headcount SSoT / `githubEmployeeMap` and are NEVER written
// here — persistence is privacy-preserving by construction.
//
// IMPORTANT: `email_hash` is currently an UNSALTED SHA-256 truncated to 16
// hex chars (see `hashEmailForRanking`). This is a deliberate short-term
// choice so snapshot keys align with the existing `impact-model.json`
// convention; anyone with DB read access plus the Cleo email directory
// could recover identity by precomputing `sha256(email)[:16]` over the
// small plausible keyspace. Tracked follow-up: wire this through the
// `IMPACT_MODEL_HASH_KEY` HMAC before the snapshot table accumulates
// meaningful history.
//
// The natural key is (snapshot_date, methodology_version, email_hash) so a
// persist call is idempotent for a given calendar day under a given
// methodology version. Methodology changes bump `methodology_version`
// (`RANKING_METHODOLOGY_VERSION`) and produce a new snapshot slice rather
// than overwriting the old one — the M17 movers view compares like with
// like and labels cross-methodology movement separately.

export const engineeringRankingSnapshots = pgTable(
  "engineering_ranking_snapshots",
  {
    id: serial("id").primaryKey(),
    // Calendar day ("YYYY-MM-DD", UTC) the snapshot was taken. Buckets multiple
    // persist calls on the same day into a single idempotent row per engineer.
    snapshotDate: text("snapshot_date").notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    signalWindowStart: timestamp("signal_window_start", {
      withTimezone: true,
    }).notNull(),
    signalWindowEnd: timestamp("signal_window_end", {
      withTimezone: true,
    }).notNull(),
    // Unsalted 16-char SHA-256 hash (see `hashEmailForRanking`) — reversible
    // against the Cleo email directory; treat as pseudonymous, not anonymous.
    // Resolution to display name / email / login happens at request time.
    emailHash: text("email_hash").notNull(),
    eligibilityStatus: text("eligibility_status").notNull(),
    rank: integer("rank"),
    compositeScore: numeric("composite_score", { precision: 7, scale: 4 }),
    adjustedPercentile: numeric("adjusted_percentile", {
      precision: 7,
      scale: 4,
    }),
    rawPercentile: numeric("raw_percentile", { precision: 7, scale: 4 }),
    methodA: numeric("method_a", { precision: 7, scale: 4 }),
    methodB: numeric("method_b", { precision: 7, scale: 4 }),
    methodC: numeric("method_c", { precision: 7, scale: 4 }),
    methodD: numeric("method_d", { precision: 7, scale: 4 }),
    confidenceLow: numeric("confidence_low", { precision: 7, scale: 4 }),
    confidenceHigh: numeric("confidence_high", { precision: 7, scale: 4 }),
    // Stable hash of the per-engineer input signals (PR/commit counts, impact
    // model row, tenure days, etc.) so M17 movers can distinguish input drift
    // from methodology drift without persisting the raw signals.
    inputHash: text("input_hash"),
    // Non-identifying metadata (present-method count, dominance flag, etc.).
    // MUST NOT contain display name, email, resolved GitHub login, manager
    // name, or raw signal values — any such field is a privacy leak.
    metadata: jsonb("metadata"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("engineering_ranking_snapshots_natural_key").on(
      table.snapshotDate,
      table.methodologyVersion,
      table.emailHash,
    ),
    index("engineering_ranking_snapshots_date_version_idx").on(
      table.snapshotDate,
      table.methodologyVersion,
    ),
    index("engineering_ranking_snapshots_email_hash_idx").on(table.emailHash),
  ]
);
