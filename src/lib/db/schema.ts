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
