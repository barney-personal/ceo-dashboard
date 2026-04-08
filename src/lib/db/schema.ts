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
} from "drizzle-orm/pg-core";

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
    rowCount: integer("row_count").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [unique().on(table.reportId, table.queryToken)]
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

export const syncLog = pgTable("sync_log", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("mode"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("running"), // 'running' | 'success' | 'error'
  recordsSynced: integer("records_synced").default(0).notNull(),
  errorMessage: text("error_message"),
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
