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
